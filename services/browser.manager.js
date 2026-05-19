import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import { existsSync, unlinkSync } from "fs";
import path from "path";

chromium.use(stealth());

// ─── Clean up Chrome lock files from previous crashed/killed sessions ──────────
// On Windows, force-killing Chrome leaves SingletonLock in user_data dir.
// Next launch with same dir fails with exitCode=21. This clears them first.
const clearLocks = (userDataDir) => {
  const locks = ["SingletonLock", "SingletonSocket", "SingletonCookie"];
  for (const file of locks) {
    const lockPath = path.join(userDataDir, file);
    if (existsSync(lockPath)) {
      try {
        unlinkSync(lockPath);
      } catch {
        /* ignore */
      }
    }
  }
};

export const launchBrowser = async (platform) => {
  const userDataDir = `./user_data/${platform}`;
  clearLocks(userDataDir);

  return await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: null,
    args: [
      "--start-maximized",
      "--disable-blink-features=AutomationControlled",
    ],
  });
};
