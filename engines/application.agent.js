import { JobLead } from '../models/JobLead.js';
import { launchBrowser } from '../services/browser.manager.js';
import dotenv from 'dotenv';
dotenv.config();

export const runApplicationAgent = async (job, profile, io) => {
    const log = (msg) => io.emit('log', { message: `[APEX]: ${msg}` });
    log(`Infiltrating portal: ${job.url}`);

    let context;
    try {
        context = await launchBrowser('application');
        const page = await context.newPage();
        await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        log(`Scanning DOM with Gemini AI...`);
        
        // 1. Scrape all visible fields
        const fields = await page.evaluate(() => {
            const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="file"]), select, textarea'));
            return inputs.map(el => {
                let labelText = '';
                if (el.id) {
                    const label = document.querySelector(`label[for="${el.id}"]`);
                    if (label) labelText = label.innerText;
                }
                if (!labelText && el.closest('label')) labelText = el.closest('label').innerText;
                
                const options = el.tagName === 'SELECT' ? Array.from(el.options).map(o => o.text.trim()) : [];
                return {
                    tag: el.tagName, type: el.type, id: el.id, name: el.name,
                    label: labelText.replace(/\n/g, ' ').trim(), options
                };
            }).filter(f => f.id || f.name);
        });

        // 2. Send to Gemini
        const geminiPayload = {
            contents: [{
                parts: [{
                    text: `You are an ATS auto-filling bot. 
                    Map this Profile Data: ${JSON.stringify(profile)} 
                    To these HTML Fields: ${JSON.stringify(fields)}
                    
                    RULES:
                    1. Return ONLY a raw JSON array.
                    2. Format: [{"selector": "css_selector", "value": "text_to_type_or_select", "action": "fill|select"}]
                    3. For CSS selectors, prefer [name="xyz"] or #xyz.
                    4. If a field asks for Visa/Sponsorship, map it to the profile's 'requiresVisa' or 'workAuth'.
                    5. For EEO fields, strictly use these profile values: Gender (${profile.gender}), Race (${profile.race}), Veteran (${profile.veteran}), Disability (${profile.disability}).
                    6. If a required field is NOT in the profile and you cannot deduce it, add "unanswered": true to that object.`
                }]
            }]
        };

        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${process.env.GEMINI_API_KEY}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(geminiPayload)
        });

        const llmData = await res.json();
        
        // Handle Gemini Quota / Error
        if (!llmData.candidates) {
             log(`❌ Gemini API Failed. Check API quota or server load.`);
             job.status = 'MANUAL_REVIEW_NEEDED';
             await job.save();
             await context.close();
             return;
        }

        const rawJsonString = llmData.candidates[0].content.parts[0].text.replace(/```json/g, '').replace(/```/g, '').trim();
        const actions = JSON.parse(rawJsonString);

        // 3. Execute Playwright Actions
        let needsHuman = false;
        for (const action of actions) {
            if (action.unanswered) {
                log(`⚠️ Unknown Question Detected via LLM: ${action.selector}`);
                needsHuman = true;
                continue;
            }
            try {
                if (action.action === 'fill') await page.fill(action.selector, action.value, { delay: 30 });
                else if (action.action === 'select') await page.selectOption(action.selector, { label: action.value });
            } catch (e) {
                log(`Failed to map field: ${action.selector}`);
            }
        }

        // 4. Attach Resume Manually
        if (profile.resumePath) {
            const fileInput = await page.$('input[type="file"]');
            if (fileInput) await fileInput.setInputFiles(profile.resumePath);
        }

        if (needsHuman) {
            log(`⚠️ BROWSER HELD OPEN: 60 SECONDS. COMPLETE MISSING FIELDS MANUALLY.`);
            job.status = 'MANUAL_REVIEW_NEEDED';
            await job.save();
            await new Promise(r => setTimeout(r, 60000));
        } else {
            log(`✅ Payload fully injected autonomously. (Submit locked for testing)`);
            job.status = 'APPLIED';
            await job.save();
        }

        await context.close();

    } catch (err) {
        log(`❌ Execution Error: ${err.message}`);
        job.status = 'FAILED';
        await job.save();
        if (context) await context.close();
    }
};