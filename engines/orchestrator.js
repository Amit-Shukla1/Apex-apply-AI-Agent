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
                status: { $in: ['DISCOVERED', 'CAPTCHA_BLOCKED', 'FAILED_NEEDS_HEALING', 'ACCOUNT_SETUP_NEEDED'] }
            }).sort({
                // Greenhouse first (greenhouse.io in URL = higher confidence, fewer card-field issues)
                // then by relevance score desc, then oldest first as tiebreaker
                relevanceScore: -1,
                createdAt: 1
            }).limit(10);

            // Re-sort in JS: Greenhouse before Lever before Workday, then by score
            const platformRank = (url) => {
                if (url?.includes('greenhouse')) return 2;
                if (url?.includes('lever')) return 1;
                return 0; // workday + anything else
            };
            pendingJobs.sort((a, b) => {
                const rankDiff = platformRank(b.url) - platformRank(a.url);
                if (rankDiff !== 0) return rankDiff;
                return (b.relevanceScore || 0) - (a.relevanceScore || 0);
            });

            const [lead] = pendingJobs;

            if (pendingJobs.length === 0) {
                log('No pending jobs. Deploying Discovery Agent...');
                await runDiscoveryAgent(profile, 'Remote', io);
                await new Promise(resolve => setTimeout(resolve, 60000));
                continue;
            }

            const job = lead;
            const platformLabel = job.url?.includes('greenhouse')
                ? 'Greenhouse'
                : job.url?.includes('lever')
                    ? 'Lever'
                    : job.url?.includes('myworkday')
                        ? 'Workday'
                        : 'Unknown';
            log(`Routing: ${job.jobTitle} at ${job.company} (${job.status}) [${platformLabel}]`);

            switch (job.status) {
                case 'DISCOVERED':
                    await runApplicationAgent(job, profile, io);
                    break;
                case 'CAPTCHA_BLOCKED':
                    log('CAPTCHA locked — manual intervention needed.');
                    break;
                case 'ACCOUNT_SETUP_NEEDED':
                    log('Workday account/sign-in needed — manual intervention needed.');
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
