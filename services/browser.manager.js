import { chromium } from "playwright";
import { existsSync, unlinkSync } from "fs";
import path from "path";

// ─────────────────────────────────────────────────────────────────────────────
// services/browser.manager.js
//
// Launches a normal, visible Chromium window. No stealth plugin, no
// anti-bot-detection flags — this is a copilot tool: a human is meant to be
// watching this window, reviewing the filled fields, solving any CAPTCHA
// that shows up, and clicking the real Submit button themselves.
// ─────────────────────────────────────────────────────────────────────────────

// Clean up Chrome lock files from previous crashed/killed sessions.
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
    headless: false, // always visible — a human needs to see and act on this
    viewport: null,
    args: ["--start-maximized"],
  });
};
