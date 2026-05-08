import { JobLead } from '../models/JobLead.js';
import { runDiscoveryAgent } from './discovery.agent.js';
import { runApplicationAgent } from './application.agent.js';
import { runSelfHealingAgent } from './healing.agent.js';

export const startOrchestrator = async (io, profile) => {
    const log = (msg) => io.emit('log', { message: `🧠 [ORCHESTRATOR]: ${msg}` });
    log("System Online. Booting State Machine...");

    while (true) {
        // --- MASTER KILL SWITCH ---
        if (!global.isAgentRunning) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            continue; 
        }

        try {
            const pendingJobs = await JobLead.find({ 
                status: { $in: ['DISCOVERED', 'CAPTCHA_BLOCKED', 'FAILED_NEEDS_HEALING'] } 
            }).sort({ createdAt: 1 }).limit(1);

            if (pendingJobs.length === 0) {
                log("No pending jobs in queue. Deploying Discovery Agent...");
                await runDiscoveryAgent(profile, "Remote", io);
                await new Promise(resolve => setTimeout(resolve, 60000));
                continue;
            }

            const job = pendingJobs[0];
            log(`Routing Job: ${job.jobTitle} at ${job.company} (${job.status})`);

            switch (job.status) {
                case 'DISCOVERED':
                    log(`Handing off to Application Agent...`);
                    await runApplicationAgent(job, profile, io);
                    break;
                case 'CAPTCHA_BLOCKED':
                    log(`Warning: URL Captcha locked. Handing to Proxy...`);
                    break;
                case 'FAILED_NEEDS_HEALING':
                    log(`Form changed! Handing to Healing Agent...`);
                    await runSelfHealingAgent(job, io);
                    break;
            }
            await new Promise(resolve => setTimeout(resolve, 5000));

        } catch (error) {
            log(`CRITICAL SYSTEM FAILURE: ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, 10000));
        }
    }
};