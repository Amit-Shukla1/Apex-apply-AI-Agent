import { JobLead } from "../models/JobLead.js";
import { launchBrowser } from "../services/browser.manager.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randomDelay = (min = 1000, max = 2000) =>
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
    if (hostname.includes("myworkdayjobs.com")) {
      // e.g. https://nvidia.wd5.myworkdayjobs.com/en-US/.../job/.../Some-Title_R12345
      return pathname.includes("/job/");
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

  return [...new Set(rawUrls.filter(isRealJobUrl))].slice(0, 15);
};

// Extract just the country from "City, Country" — used for broader DDG searches.
// Greenhouse/Lever are global platforms; city-level searches return almost nothing.
const getCountryHint = (loc) => {
  if (!loc || loc === "Remote") return null;
  const parts = loc
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // If only one part, it might be a country already
  return parts[parts.length - 1] || null;
};

// ─── Main Discovery Agent ─────────────────────────────────────────────────────
export const runDiscoveryAgent = async (
  profile,
  location,
  io,
  platform,
  userId,
) => {
  const log = (msg) => io.emit("log", { message: `[APEX DISCOVERY]: ${msg}` });

  const titles = profile.titles || ["Software Engineer"];
  const cleanedLocation = cleanLocation(location || profile.location);

  // Greenhouse/Lever are global remote-first platforms — searching by small
  // city returns almost nothing. Always search "remote" + optionally country.
  const countryHint = getCountryHint(cleanedLocation);
  const searchLocations = ["remote"];
  if (countryHint && countryHint.toLowerCase() !== "remote") {
    searchLocations.push(countryHint);
  }
  log(
    `Initiating scan for ${titles.length} titles (searching: ${searchLocations.join(", ")})...`,
  );

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
      const urlSet = new Set();

      // Run multiple query variants per title to get more results and avoid
      // DDG returning the same 10 results for every search.
      // Split greenhouse and lever into separate queries — DDG's OR operator
      // often returns fewer results than two separate targeted searches.
      // NOTE: title alone is used — no hardcoded "developer"/"software engineer"
      // suffix, so this works for any role (designer, marketer, analyst, etc.)
      //
      // Two variants keep the exact-phrase quotes (precise, but real postings
      // rarely contain a Gemini-generated title like "MERN Full Stack
      // Developer" verbatim — this alone can starve discovery down to a
      // handful of results). The other two drop the quotes so DDG does
      // ordinary relevance matching on the same words instead of requiring
      // an exact substring match.
      const queryVariants = [
        `site:job-boards.greenhouse.io "${title}" remote`,
        `site:jobs.lever.co "${title}" remote`,
        `site:boards.greenhouse.io OR site:job-boards.greenhouse.io ${title} remote`,
        `site:jobs.lever.co ${title} remote hiring`,
        `site:myworkdayjobs.com ${title} remote`,
      ];

      for (let i = 0; i < queryVariants.length; i++) {
        const query = queryVariants[i];
        log(`🔍 Searching: ${title} — query ${i + 1}/${queryVariants.length}`);
        const urls = await searchDDG(page, query, log);
        urls.forEach((u) => urlSet.add(u));
        // Stagger requests to avoid DDG rate-limiting — kept non-zero on
        // purpose, this protects YOU from getting your IP rate-limited by
        // DDG, which would be far worse for speed than this delay is.
        await randomDelay(1000, 2000);
      }

      const urls = [...urlSet];
      log(`   Found ${urls.length} unique valid URL(s) for "${title}"`);

      for (const url of urls) {
        const exists = await JobLead.findOne({ url, userId });
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
          await randomDelay(500, 1000);

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
            userId,
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

      await randomDelay(1500, 3000);
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
    const { hostname, pathname } = new URL(url);
    if (hostname.includes("myworkdayjobs.com")) {
      // e.g. nvidia.wd5.myworkdayjobs.com → "nvidia" (first label of the subdomain)
      const company = hostname.split(".")[0];
      return company?.replace(/-/g, " ").toUpperCase() || "UNKNOWN";
    }
    const parts = pathname.split("/").filter((p) => p);
    return parts[0]?.replace(/-/g, " ").toUpperCase() || "UNKNOWN";
  } catch {
    return "UNKNOWN";
  }
};
