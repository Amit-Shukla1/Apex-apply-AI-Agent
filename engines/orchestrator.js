import { JobLead } from '../models/JobLead.js';
import { runDiscoveryAgent } from './discovery.agent.js';
import { runApplicationAgent } from './application.agent.js';
import { runSelfHealingAgent } from './healing.agent.js';

// Shared state — server.js calls setRunning() to control this
let isRunning = false;
export const setRunning = (val) => { isRunning = val; };
export const getRunning = () => isRunning;

export const startOrchestrator = async (io, profile) => {
    const log = (msg) => io.emit('log', { message: `🧠 [ORCHESTRATOR]: ${msg}` });
    log('System Online. Booting State Machine...');

    while (true) {
        if (!isRunning) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            continue;
        }

        try {
            const pendingJobs = await JobLead.find({
                status: { $in: ['DISCOVERED', 'CAPTCHA_BLOCKED', 'FAILED_NEEDS_HEALING'] }
            }).sort({ createdAt: 1 }).limit(1);

            if (pendingJobs.length === 0) {
                log('No pending jobs. Deploying Discovery Agent...');
                await runDiscoveryAgent(profile, 'Remote', io);
                await new Promise(resolve => setTimeout(resolve, 60000));
                continue;
            }

            const job = pendingJobs[0];
            log(`Routing: ${job.jobTitle} at ${job.company} (${job.status})`);

            switch (job.status) {
                case 'DISCOVERED':
                    await runApplicationAgent(job, profile, io);
                    break;
                case 'CAPTCHA_BLOCKED':
                    log('CAPTCHA locked — manual intervention needed.');
                    break;
                case 'FAILED_NEEDS_HEALING':
                    await runSelfHealingAgent(job, io);
                    break;
            }

            await new Promise(resolve => setTimeout(resolve, 5000));

        } catch (error) {
            log(`CRITICAL ERROR: ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, 10000));
        }
    }
};
