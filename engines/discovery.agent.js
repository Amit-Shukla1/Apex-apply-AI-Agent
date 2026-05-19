import { JobLead } from "../models/JobLead.js";
import { launchBrowser } from "../services/browser.manager.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randomDelay = (min = 2000, max = 5000) =>
  sleep(Math.floor(Math.random() * (max - min + 1)) + min);

// ─── Strict job URL validator ──────────────────────────────────────────────────
// Rejects homepages, docs, support pages, marketing — only real job listings.
// Greenhouse: must be job-boards.greenhouse.io or boards.greenhouse.io with /jobs/{id}
// Lever:      must be jobs.lever.co/{company}/{uuid}
const isRealJobUrl = (url) => {
  try {
    const { hostname, pathname } = new URL(url);
    if (hostname.includes("greenhouse.io")) {
      const isBoard =
        hostname.startsWith("job-boards.") || hostname.startsWith("boards.");
      const hasJobId = /\/jobs\/\d+/.test(pathname);
      return isBoard && hasJobId;
    }
    if (hostname.includes("lever.co")) {
      const isJobsHost = hostname === "jobs.lever.co";
      const hasUUID =
        /\/[^/]+\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(
          pathname,
        );
      return isJobsHost && hasUUID;
    }
    return false;
  } catch {
    return false;
  }
};

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

// ─── DuckDuckGo HTML search ────────────────────────────────────────────────────
const searchDDG = async (page, query, log) => {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(1000);
  } catch (e) {
    log(`⚠️  DDG load failed: ${e.message.split("\n")[0]}`);
    return [];
  }

  const rawUrls = await page.evaluate(() => {
    const links = Array.from(
      document.querySelectorAll("a.result__a, a.result__url"),
    );
    return links
      .map((a) => {
        let href = a.href || "";
        if (href.includes("duckduckgo.com/l/")) {
          const match = href.match(/uddg=([^&]+)/);
          if (match) href = decodeURIComponent(match[1]);
        }
        return href;
      })
      .filter((href) => href && href.startsWith("http"));
  });

  return [...new Set(rawUrls.filter(isRealJobUrl))].slice(0, 10);
};

// ─── Main Discovery Agent ─────────────────────────────────────────────────────
export const runDiscoveryAgent = async (profile, location, io) => {
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
      const query = `site:greenhouse.io OR site:lever.co ${title} ${cleanedLocation}`;
      log(`🔍 Searching: ${title} — ${cleanedLocation}`);

      const urls = await searchDDG(page, query, log);
      log(`   Found ${urls.length} valid job lead(s) for "${title}"`);

      for (const url of urls) {
        const exists = await JobLead.findOne({ url });
        if (exists) {
          log(`⏭️  Already tracked: ${url}`);
          continue;
        }

        log(`🔎 Inspecting: ${url}`);
        try {
          await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 20000,
          });
          await randomDelay(1000, 2000);

          const jobText = await page
            .evaluate(() => document.body.innerText)
            .catch(() => "");

          if (profile.minSalary || profile.maxSalary) {
            if (!passesSalaryFilter(jobText, profile.minSalary)) {
              log(`⚠️  Dropped: salary below requirement`);
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
          log(`⚠️  Could not inspect ${url}: ${e.message.split("\n")[0]}`);
        }
      }

      await randomDelay(3000, 6000);
    }

    log(`🏁 Discovery complete. ${totalSaved} new leads saved.`);
    await context.close();
  } catch (err) {
    log(`❌ Discovery error: ${err.message}`);
    if (context) await context.close();
  }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const passesSalaryFilter = (jobDescription, minUserSalary) => {
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
    const { pathname } = new URL(url);
    const parts = pathname.split("/").filter((p) => p);
    return parts[0]?.replace(/-/g, " ").toUpperCase() || "UNKNOWN";
  } catch {
    return "UNKNOWN";
  }
};
