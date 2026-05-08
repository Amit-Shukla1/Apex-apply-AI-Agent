import { launchBrowser } from "../services/browser.manager.js";
import { delay, getRandomJitter } from "../services/stealth.utils.js";

export const runGoogleJobsAgent = async (profile, io) => {
  const log = (msg) => io.emit("log", { message: msg });

  // --- TARGET LOCATION ---
  // Change this to "USA", "Europe", "Worldwide", or keep it as "Remote"
  const searchLocation = "Remote";

  const context = await launchBrowser("google");
  const page = await context.newPage();

  for (const title of profile.titles) {
    log(`🔍 Google Search: ${title} in ${searchLocation}`);

    // Dynamic search query based on your preferred location
    const query = encodeURIComponent(`${title} jobs ${searchLocation}`);
    await page.goto(`https://www.google.com/search?q=${query}&ibp=htl;jobs`);

    // --- MANUAL OVERRIDE TRAP (CAPTCHA) ---
    const captchaBlock = await page.$('text="unusual traffic"');
    if (captchaBlock) {
      log("🛑 CAPTCHA DETECTED! Intercepting...");
      log("⏳ You have 60 seconds to solve it in the browser.");
      try {
        await page.waitForSelector('[role="listitem"]', { timeout: 60000 });
        log("✅ Captcha cleared! Resuming...");
      } catch (e) {
        log("❌ Captcha timeout. Skipping role.");
        continue;
      }
    } else {
      await delay(getRandomJitter(3000, 5000));
    }

    const jobs = await page.$$('[role="listitem"]');
    log(`✅ Found ${jobs.length} leads. Initiating deep extraction...`);

    // --- THE APPLY-LINK EXTRACTOR ---
    let applicationLinks = [];

    // Loop through the first 5 jobs
    for (let i = 0; i < Math.min(jobs.length, 5); i++) {
      try {
        // Click the job card to open the description panel
        await jobs[i].click();
        await delay(getRandomJitter(1500, 3000));

        // Hunt for the 'Apply' buttons in the expanded panel
        const applyButtons = await page.$$('a:has-text("Apply")');

        for (let btn of applyButtons) {
          const link = await btn.getAttribute("href");
          // Filter out Google's internal search links
          if (link && !link.includes("google.com/search")) {
            applicationLinks.push(link);
            log(`🔗 Extracted Apply Link: ${link.substring(0, 55)}...`);
          }
        }
      } catch (err) {
        log(`⚠️ Could not extract link for job ${i + 1}`);
      }
    }

    log(
      `🎯 Harvested ${applicationLinks.length} direct application portals for ${title}.`,
    );
  }

  log("🏁 Google Discovery Complete.");
};
