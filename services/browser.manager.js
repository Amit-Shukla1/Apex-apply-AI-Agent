import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
chromium.use(stealth());
export const launchBrowser = async (platform) => {
    return await chromium.launchPersistentContext(`./user_data/${platform}`, {
        headless: false,
        args: ['--start-maximized', '--disable-blink-features=AutomationControlled']
    });
};