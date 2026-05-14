import { JobLead } from '../models/JobLead.js';
import { launchBrowser } from '../services/browser.manager.js';
import dotenv from 'dotenv';
dotenv.config();

const callGroq = async (prompt) => {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
        },
        body: JSON.stringify({
            model: 'llama-3.1-8b-instant',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.2
        })
    });
    const data = await res.json();
    if (!data.choices) throw new Error('Groq API failed: ' + JSON.stringify(data));
    return data.choices[0].message.content
        .replace(/```json/g, '').replace(/```/g, '').trim();
};

export const runSelfHealingAgent = async (job, io) => {
    const log = (msg) => io.emit('log', { message: `[HEALING AGENT]: ${msg}` });
    log(`Analyzing broken DOM for: ${job.jobTitle} at ${job.company}`);

    let context;
    try {
        context = await launchBrowser('healing');
        const page = await context.newPage();

        await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const html = await page.evaluate(() => document.body.innerHTML);
        const snippet = html.substring(0, 8000);

        log('Sending broken DOM to Groq...');

        const result = JSON.parse(await callGroq(`You are an expert web scraper fixing a broken job application form.
A CSS selector stopped working. Analyze this HTML and find the best selector for the SUBMIT / Apply button.

Return ONLY raw JSON:
{
  "selector": "css_selector_here",
  "confidence": "high|medium|low",
  "reason": "one sentence explanation"
}

HTML:
${snippet}`));

        log(`🧠 New selector: "${result.selector}" (confidence: ${result.confidence})`);
        log(`Reason: ${result.reason}`);

        job.aiGeneratedSelector = result.selector;
        job.lastKnownHtml = null;
        job.status = 'DISCOVERED';
        await job.save();

        log('✅ Healing complete. Job re-queued.');
        await context.close();

    } catch (err) {
        log(`❌ Healing failed: ${err.message}`);
        job.status = 'FAILED';
        await job.save();
        if (context) await context.close();
    }
};
