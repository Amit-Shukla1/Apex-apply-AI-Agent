import { launchBrowser } from '../services/browser.manager.js';
import { delay, getRandomJitter } from '../services/stealth.utils.js';
import { LINKEDIN_SELECTORS } from '../config/selectors.js';

export const runLinkedInAgent = async (profile, io) => {
    const log = (msg) => io.emit('log', { message: msg });
    log("🚀 Launching LinkedIn Engine...");
    const context = await launchBrowser('linkedin');
    const page = await context.newPage();
    await page.goto('https://www.linkedin.com/jobs/');
    
    if (await page.isVisible('button.sign-in-form__submit-button')) {
        log("⚠️ Please log in manually in the browser window.");
        await page.waitForNavigation({ timeout: 0 });
    }
    log("🔍 Searching jobs...");
    const query = encodeURIComponent(profile.titles[0]);
    await page.goto(`https://www.linkedin.com/jobs/search/?keywords=${query}`);
};