import { JobLead } from "../models/JobLead.js";
import { launchBrowser } from "../services/browser.manager.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randomDelay = (min = 2000, max = 5000) =>
  sleep(Math.floor(Math.random() * (max - min + 1)) + min);

// If Groq returned a placeholder, default to Remote
const cleanLocation = (loc) => {
  if (!loc) return "Remote";
  const placeholders = [
    "city, country",
    "city,country",
    "location",
    "your city",
    "n/a",
    "unknown",
  ];
  if (placeholders.some((p) => loc.toLowerCase().includes(p))) return "Remote";
  return loc;
};

// Wait for user to solve CAPTCHA if Google shows one
const handleCaptcha = async (page, log) => {
  const isCaptcha = await page
    .evaluate(() => {
      const body = document.body.innerText.toLowerCase();
      return (
        body.includes("unusual traffic") ||
        body.includes("not a robot") ||
        body.includes("captcha") ||
        body.includes("recaptcha")
      );
    })
    .catch(() => false);

  if (isCaptcha) {
    log("⚠️ CAPTCHA detected! Please solve it in the browser window...");
    // Wait up to 2 minutes for user to solve it
    let solved = false;
    for (let i = 0; i < 24; i++) {
      await sleep(5000);
      const stillCaptcha = await page
        .evaluate(() => {
          const body = document.body.innerText.toLowerCase();
          return (
            body.includes("unusual traffic") ||
            body.includes("not a robot") ||
            body.includes("captcha")
          );
        })
        .catch(() => false);

      if (!stillCaptcha) {
        solved = true;
        log("✅ CAPTCHA solved! Continuing...");
        break;
      }
      log(`⏳ Waiting for CAPTCHA solve... (${(i + 1) * 5}s)`);
    }

    if (!solved) {
      log("❌ CAPTCHA timeout. Skipping this search.");
      return false;
    }
  }
  return true;
};

export const runDiscoveryAgent = async (
  profile,
  location,
  io,
  platform = "Google",
) => {
  const log = (msg) => io.emit("log", { message: `[APEX DISCOVERY]: ${msg}` });

  const titles = profile.titles || ["Software Engineer"];
  const cleanedLocation = cleanLocation(location || profile.location);
  log(`Initiating scan for ${titles.length} titles in "${cleanedLocation}"...`);

  let context;
  try {
    context = await launchBrowser("discovery");
    const page = await context.newPage();

    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    });

    let totalSaved = 0;

    for (const title of titles) {
      // Back to Google — it finds the most results
      const searchQuery = `site:greenhouse.io OR site:lever.co ${title} ${cleanedLocation}`;
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`;

      log(`🔍 Searching: ${title} — ${cleanedLocation}`);

      try {
        await page.goto(searchUrl, {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });
        await sleep(1500);
      } catch (e) {
        log(`⚠️ Search failed for "${title}": ${e.message}`);
        continue;
      }

      // Handle CAPTCHA before extracting
      const ok = await handleCaptcha(page, log);
      if (!ok) continue;

      // Extract greenhouse/lever URLs from Google results
      const urls = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll("a"));
        return links
          .map((a) => a.href)
          .filter(
            (href) =>
              href &&
              (href.includes("boards.greenhouse.io") ||
                href.includes("jobs.lever.co") ||
                href.includes("greenhouse.io") ||
                href.includes("lever.co")) &&
              !href.includes("google.com") &&
              !href.includes("webcache") &&
              href.startsWith("http"),
          );
      });

      const uniqueUrls = [...new Set(urls)].slice(0, 10);
      log(`Found ${uniqueUrls.length} leads for "${title}"`);

      for (const url of uniqueUrls) {
        const exists = await JobLead.findOne({ url });
        if (exists) {
          log(`⏭️ Already tracked: ${url}`);
          continue;
        }

        log(`🔎 Inspecting: ${url}`);

        try {
          await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 15000,
          });
          await randomDelay(1000, 2000);

          const jobText = await page
            .evaluate(() => document.body.innerText)
            .catch(() => "");

          if (profile.minSalary || profile.maxSalary) {
            const passes = passesSalaryFilter(
              jobText,
              profile.minSalary,
              profile.maxSalary,
            );
            if (!passes) {
              log(`⚠️ Dropped: Salary below requirement`);
              continue;
            }
          }

          const newLead = new JobLead({
            company: extractCompanyName(url),
            jobTitle: title,
            url,
            status: "DISCOVERED",
          });
          await newLead.save();
          totalSaved++;
          log(`✅ Acquired: ${newLead.company} — ${title}`);
        } catch (e) {
          log(`⚠️ Could not inspect ${url}: ${e.message}`);
        }
      }

      // Random delay between searches — avoids triggering Google bot detection
      await randomDelay(4000, 8000);
    }

    log(`🏁 Discovery complete. ${totalSaved} new leads saved.`);
    await context.close();
  } catch (err) {
    log(`❌ Discovery Error: ${err.message}`);
    if (context) await context.close();
  }
};

const passesSalaryFilter = (jobDescription, minUserSalary, maxUserSalary) => {
  const text = jobDescription.toLowerCase().replace(/,/g, "");
  const salaries = [];
  let match;

  const fullNumRegex = /\$?\b([1-9]\d{4,5})\b/g;
  while ((match = fullNumRegex.exec(text)) !== null)
    salaries.push(parseInt(match[1]));

  const kRegex = /\$?\b([1-9]\d{1,2})k\b/g;
  while ((match = kRegex.exec(text)) !== null)
    salaries.push(parseInt(match[1]) * 1000);

  if (salaries.length === 0) return true;

  const jobMax = Math.max(...salaries);
  const userMin = minUserSalary
    ? parseInt(minUserSalary.toString().replace(/\D/g, ""))
    : 0;

  return jobMax >= userMin;
};

const extractCompanyName = (url) => {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter((p) => p);
    return parts[0] ? parts[0].replace(/-/g, " ").toUpperCase() : "UNKNOWN";
  } catch {
    return "UNKNOWN";
  }
};
