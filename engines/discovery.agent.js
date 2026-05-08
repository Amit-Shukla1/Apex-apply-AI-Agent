import { JobLead } from '../models/JobLead.js';
import { launchBrowser } from '../services/browser.manager.js';

export const runDiscoveryAgent = async (profile, location, io, platform = 'Google') => {
    const log = (msg) => io.emit('log', { message: `[APEX DISCOVERY]: ${msg}` });
    
    const titles = profile.titles || ["Software Engineer"];
    log(`Initiating ${platform} scan for ${titles[0]}...`);

    let context;
    try {
        context = await launchBrowser('discovery');
        const page = await context.newPage();
        
        // Build Search Query based on target titles
        const titleQuery = titles.map(t => `"${t}"`).join(' OR ');
        const searchQuery = `site:greenhouse.io OR site:lever.co ${titleQuery} ${location || 'Remote'}`;
        
        log(`Querying search engine...`);
        await page.goto(`https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`, { waitUntil: 'domcontentloaded' });

        // Extract ATS URLs from Google Results
        const urls = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            return links
                .map(a => a.href)
                .filter(href => href.includes('boards.greenhouse.io') || href.includes('jobs.lever.co'));
        });

        const uniqueUrls = [...new Set(urls)].slice(0, 10); // Limit to 10 per cycle to avoid detection
        log(`Found ${uniqueUrls.length} potential targets.`);

        for (const url of uniqueUrls) {
            // Skip if we already scraped this job
            const exists = await JobLead.findOne({ url });
            if (exists) continue;

            log(`Inspecting: ${url}`);
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
            
            // Scrape the entire page text to look for salary details
            const jobText = await page.evaluate(() => document.body.innerText).catch(() => '');
            
            // Execute Salary Filter Evaluation
            if (profile.minSalary || profile.maxSalary) {
                const passes = passesSalaryFilter(jobText, profile.minSalary, profile.maxSalary);
                if (!passes) {
                    log(`⚠️ Dropped Target: Salary below requirement (${url})`);
                    continue;
                }
            }

            // Save the qualified lead to MongoDB
            const newLead = new JobLead({
                company: extractCompanyName(url),
                jobTitle: titles[0],
                url: url,
                status: 'DISCOVERED'
            });
            await newLead.save();
            log(`✅ Target Acquired & Verified: ${newLead.company}`);
        }

        await context.close();

    } catch (err) {
        log(`❌ Discovery Error: ${err.message}`);
        if (context) await context.close();
    }
};

const passesSalaryFilter = (jobDescription, minUserSalary, maxUserSalary) => {
    // Clean text: lowercase, remove commas for easier parsing
    const text = jobDescription.toLowerCase().replace(/,/g, '');
    const salaries = [];
    let match;
    
    // Extract full number formats (e.g. 80000, 120000, $150000)
    const fullNumRegex = /\$?\b([1-9]\d{4,5})\b/g;
    while ((match = fullNumRegex.exec(text)) !== null) {
        salaries.push(parseInt(match[1]));
    }

    // Extract 'k' formats (e.g. 80k, 120k, $150k)
    const kRegex = /\$?\b([1-9]\d{1,2})k\b/g;
    while ((match = kRegex.exec(text)) !== null) {
        salaries.push(parseInt(match[1]) * 1000);
    }

    // If the company hid the salary, we KEEP the job so you don't miss out.
    if (salaries.length === 0) return true; 

    // Find the min and max salary offered by the company
    const jobMin = Math.min(...salaries);
    const jobMax = Math.max(...salaries);
    
    // Parse the user's requirements (strip out $ and commas)
    const userMin = minUserSalary ? parseInt(minUserSalary.toString().replace(/\D/g, '')) : 0;
    const userMax = maxUserSalary ? parseInt(maxUserSalary.toString().replace(/\D/g, '')) : 9999999;

    // Overlap Logic: The company's max offer must be greater than or equal to your absolute minimum
    return jobMax >= userMin;
};

const extractCompanyName = (url) => {
    try {
        const parsed = new URL(url);
        const parts = parsed.pathname.split('/').filter(p => p);
        // Greenhouse format: boards.greenhouse.io/companyname
        // Lever format: jobs.lever.co/companyname
        return parts[0] ? parts[0].toUpperCase() : 'UNKNOWN_CORP';
    } catch {
        return 'UNKNOWN_CORP';
    }
};