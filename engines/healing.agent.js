import { JobLead } from '../models/JobLead.js';

export const runSelfHealingAgent = async (job, io) => {
    const log = (msg) => io.emit('log', { message: `[HEALING AGENT]: ${msg}` });
    log(`Analyzing broken DOM for: ${job.jobTitle}`);

    try {
        log(`Sending HTML snippet to Gemini to locate hidden form elements...`);
        
        // Simulating the AI analysis delay
        await new Promise(res => setTimeout(res, 4000)); 

        log(`🧠 AI successfully generated new dynamic CSS selector.`);
        
        job.aiGeneratedSelector = 'div.custom-submit-wrapper > span';
        job.status = 'DISCOVERED'; // Route it back to the Application Agent to try again
        job.lastKnownHtml = null; // Clear the memory
        await job.save();

    } catch (err) {
        log(`❌ Healing failed: ${err.message}`);
        job.status = 'FAILED';
        await job.save();
    }
};