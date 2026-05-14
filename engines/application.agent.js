import { JobLead } from "../models/JobLead.js";
import { launchBrowser } from "../services/browser.manager.js";
import dotenv from "dotenv";
dotenv.config();

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.1-8b-instant";

// ─── DOM Fingerprinting ────────────────────────────────────────────────────────
// Runs inside page.evaluate() — no Node.js APIs allowed here.
const FINGERPRINT_FN = () => {
  const getLabelText = (el) => {
    if (el.id) {
      const lbl = document.querySelector(`label[for="${el.id}"]`);
      if (lbl) return lbl.innerText.trim();
    }
    const wrap = el.closest("label");
    if (wrap) return wrap.innerText.replace(el.value || "", "").trim();
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel.trim();
    const lblId = el.getAttribute("aria-labelledby");
    if (lblId) {
      const lbl = document.getElementById(lblId);
      if (lbl) return lbl.innerText.trim();
    }
    let prev = el.previousElementSibling;
    for (let i = 0; i < 3 && prev; i++) {
      const text = prev.innerText?.trim();
      if (text) return text;
      prev = prev.previousElementSibling;
    }
    return el.name || el.id || "";
  };

  const getHint = (el) => {
    const descId = el.getAttribute("aria-describedby");
    if (!descId) return "";
    return [...descId.split(" ")]
      .map((id) => document.getElementById(id)?.innerText?.trim())
      .filter(Boolean)
      .join(" ");
  };

  const getSectionContext = (el) => {
    const fieldset = el.closest("fieldset");
    if (fieldset) {
      const legend = fieldset.querySelector("legend");
      if (legend) return legend.innerText.trim();
    }
    let node = el.parentElement;
    for (let i = 0; i < 6 && node; i++) {
      const heading = node.querySelector(
        ":scope > h1,:scope > h2,:scope > h3,:scope > h4,:scope > h5",
      );
      if (heading) return heading.innerText.trim();
      node = node.parentElement;
    }
    return "";
  };

  const bestSelector = (el) => {
    if (el.id) return `#${CSS.escape(el.id)}`;
    if (el.name) return `[name="${el.name}"]`;
    return null;
  };

  // FIX 4: Filter out invisible elements and known noise fields
  const isVisible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (rect.width === 0 && rect.height === 0) return false;
    return true;
  };
  const NOISE = [
    /g-recaptcha/i,
    /iti.*search/i,
    /captcha/i,
    /csrf/i,
    /honeypot/i,
  ];
  const isNoise = (el) =>
    NOISE.some((p) => p.test(`${el.id} ${el.name} ${el.className}`));

  const fingerprints = [];

  // ── Standard inputs / selects / textareas ─────────────────────────────────
  const QUERY = [
    'input:not([type="hidden"]):not([type="file"]):not([type="radio"]):not([type="submit"])',
    "select",
    "textarea",
  ].join(", ");

  for (const el of document.querySelectorAll(QUERY)) {
    const selector = bestSelector(el);
    if (!selector) continue;
    if (el.readOnly || el.disabled) continue;
    if (!isVisible(el) || isNoise(el)) continue; // FIX 4
    fingerprints.push({
      selector,
      tag: el.tagName,
      type: el.type || el.tagName.toLowerCase(),
      label: getLabelText(el),
      placeholder: el.placeholder || "",
      hint: getHint(el),
      context: getSectionContext(el),
      required: el.required || el.getAttribute("aria-required") === "true",
      options:
        el.tagName === "SELECT"
          ? Array.from(el.options)
              .map((o) => o.text.trim())
              .filter((t) => t && t !== "--")
          : [],
    });
  }

  // ── Radio groups ──────────────────────────────────────────────────────────
  const radioGroups = {};
  for (const radio of document.querySelectorAll('input[type="radio"]')) {
    const name = radio.name;
    if (!name || radio.disabled || !isVisible(radio)) continue;
    if (!radioGroups[name]) {
      radioGroups[name] = {
        selector: `input[name="${name}"]`,
        tag: "RADIO_GROUP",
        type: "radio",
        label: getLabelText(radio.closest("fieldset") || radio),
        hint: getHint(radio),
        context: getSectionContext(radio),
        required: radio.required,
        groupName: name,
        options: [],
      };
    }
    radioGroups[name].options.push({
      value: radio.value,
      label: getLabelText(radio),
    });
  }
  fingerprints.push(...Object.values(radioGroups));

  // ── Checkboxes ────────────────────────────────────────────────────────────
  for (const cb of document.querySelectorAll('input[type="checkbox"]')) {
    const selector = bestSelector(cb);
    if (!selector || cb.disabled || !isVisible(cb) || isNoise(cb)) continue;
    fingerprints.push({
      selector,
      tag: "CHECKBOX",
      type: "checkbox",
      label: getLabelText(cb),
      hint: getHint(cb),
      context: getSectionContext(cb),
      required: cb.required,
      options: [],
    });
  }

  return fingerprints;
};

// ─── JSON repair: recover a truncated JSON array ──────────────────────────────
// FIX 1: Groq hits max_tokens mid-response — extract all complete objects
function repairJSON(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    /* fall through to repair */
  }
  // Trim to last complete object: find last '}' and close the array
  const lastClose = raw.lastIndexOf("}");
  if (lastClose === -1)
    throw new Error("JSON repair failed — no complete objects in response");
  try {
    return JSON.parse(raw.slice(0, lastClose + 1) + "]");
  } catch {
    throw new Error("JSON repair failed — response too corrupted to salvage");
  }
}

// ─── Groq call with 429 retry + backoff ───────────────────────────────────────
// FIX 2: Rate limit retry
async function callGroq(payload, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });
    if (res.status === 429) {
      const waitMs = (attempt + 1) * 15000; // 15s, 30s, 45s
      console.log(
        `[GROQ] 429 rate limit — waiting ${waitMs / 1000}s before retry ${attempt + 1}/${retries}`,
      );
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Groq API ${res.status}: ${txt.slice(0, 200)}`);
    }
    return res;
  }
  throw new Error(
    "Groq rate limit: max retries exceeded. Try again in a minute.",
  );
}

// ─── Groq: map fingerprints → actions ─────────────────────────────────────────
// ─── Compress fingerprint payload before sending to Groq ─────────────────────
// Strips noise fields (hint, placeholder, context, tag) — cuts tokens ~60%
// Keeps only what Groq actually needs to map a field correctly
function compressForGroq(fingerprints) {
  return fingerprints.map((f) => {
    const c = {
      s: f.selector, // selector
      l: f.label, // label — most important signal
      t: f.type, // type  — fill vs select vs radio vs check
      r: f.required, // required — needed for unanswered flagging
    };
    // Only include options for SELECT and RADIO — where they actually matter
    if ((f.type === "select" || f.type === "radio") && f.options?.length)
      c.o = f.options;
    // Keep groupName for radios so Groq knows the input[name] to target
    if (f.groupName) c.g = f.groupName;
    return c;
  });
}

async function mapFieldsWithGroq(fingerprints, profile, log) {
  const compressed = compressForGroq(fingerprints);
  const validSelectors = fingerprints.map((f) => f.selector);

  const prompt = `You are an expert ATS form-filling bot. Map candidate profile data to HTML form fields.

## Candidate Profile
${JSON.stringify(profile, null, 2)}

## Form Field Fingerprints (s=selector, l=label, t=type, r=required, o=options, g=groupName)
${JSON.stringify(compressed, null, 2)}

## CRITICAL: Valid Selectors
You MUST only use selectors from this exact list — do NOT invent selectors, do NOT use profile object keys as selectors:
${JSON.stringify(validSelectors)}

## Output Rules
Return ONLY a raw JSON array — no markdown fences, no explanation, no extra text.

Each element must be one of:
- { "selector": "<from list above>", "action": "fill",   "value": "<text>" }
- { "selector": "<from list above>", "action": "select", "value": "<option label>" }
- { "selector": "<from list above>", "action": "radio",  "value": "<radio value attr>" }
- { "selector": "<from list above>", "action": "check",  "value": true|false }
- { "selector": "<from list above>", "action": "fill",   "value": "", "unanswered": true }

Rules:
1. Work authorisation fields → profile.workAuth
2. Visa/sponsorship fields → profile.requiresVisa (map to "Yes"/"No" for selects)
3. EEO fields (gender, race, veteran, disability) → exact values from profile
4. "How did you hear" → default "LinkedIn" if not in profile
5. If a required field cannot be mapped → include it with "unanswered": true
6. Omit optional fields you cannot map
7. For SELECT, "value" must exactly match one of the field's listed options
8. URL fields — map by label keyword, do NOT mark as unanswered:
   - label contains "linkedin"              → profile.linkedinUrl
   - label contains "github"               → profile.githubUrl
   - label contains "portfolio"            → profile.portfolioUrl
   - label contains "website" or "url"     → profile.websiteUrl or profile.portfolioUrl
   - label contains "cover letter"         → profile.summary (use as plain text)`;

  const res = await callGroq({
    model: GROQ_MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1,
    max_tokens: 4096, // FIX 1: was 2048, caused truncation
  });

  const data = await res.json();
  const raw = data.choices[0].message.content
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();

  log(`🧠 Groq mapped ${fingerprints.length} fields → parsing actions...`);
  return repairJSON(raw); // FIX 1: repair truncated JSON instead of hard crash
}

// ─── Execute Playwright actions ───────────────────────────────────────────────
async function executeActions(page, actions, log) {
  let needsHuman = false;

  for (const action of actions) {
    // FIX 6: handle both {unanswered:true} and {action:"unanswered"}
    if (action.unanswered || action.action === "unanswered") {
      log(`⚠️  Unmapped field: ${action.selector}`);
      needsHuman = true;
      continue;
    }
    try {
      switch (action.action) {
        case "fill":
          await page.fill(action.selector, String(action.value), {
            timeout: 5000,
          });
          break;
        case "select":
          await page.selectOption(
            action.selector,
            { label: String(action.value) },
            { timeout: 5000 },
          );
          break;
        case "radio": {
          const name = action.selector.match(/\[name="(.+?)"\]/)?.[1];
          const radioSel = `input[name="${name}"][value="${action.value}"]`;
          await page.click(radioSel, { timeout: 5000 });
          break;
        }
        case "check": {
          const checked = await page
            .isChecked(action.selector)
            .catch(() => false);
          if (Boolean(action.value) !== checked)
            await page.click(action.selector, { timeout: 5000 });
          break;
        }
        default:
          log(`⚠️  Unknown action type: ${action.action}`);
      }
    } catch (err) {
      log(
        `⚠️  Field fill failed [${action.selector}]: ${err.message.split("\n")[0]}`,
      );
    }
  }

  return needsHuman;
}

// ─── Attach resume ─────────────────────────────────────────────────────────────
async function attachResume(page, resumePath, log) {
  if (!resumePath) return;
  try {
    const fileInput = await page.$('input[type="file"]');
    if (fileInput) {
      await fileInput.setInputFiles(resumePath);
      log(`📎 Resume attached.`);
    }
  } catch (err) {
    log(`⚠️  Resume attach failed: ${err.message}`);
  }
}

// ─── Submit detection ──────────────────────────────────────────────────────────
async function findSubmitButton(page) {
  const CANDIDATES = [
    'button[type="submit"]',
    'input[type="submit"]',
    '[data-testid="submit-app-btn"]',
    '[data-testid="apply-button"]',
    'button:has-text("Submit Application")',
    'button:has-text("Submit")',
    'button:has-text("Apply Now")',
    'button:has-text("Apply")',
    ".submit-btn",
    "#submit-app",
  ];
  for (const sel of CANDIDATES) {
    try {
      const btn = await page.$(sel);
      if (btn && (await btn.isVisible())) return btn;
    } catch {
      /* continue */
    }
  }
  return null;
}

async function detectSuccess(page) {
  const SIGNALS = [
    "text=/thank you/i",
    "text=/application submitted/i",
    "text=/application received/i",
    "text=/successfully applied/i",
    ".application-confirmation",
    '[data-testid="app-submitted"]',
    ".success-message",
  ];
  for (const sel of SIGNALS) {
    try {
      if (await page.$(sel)) return true;
    } catch {
      /* continue */
    }
  }
  return false;
}

// ─── Verify Fill ──────────────────────────────────────────────────────────────
async function verifyFill(page, actions, originalFingerprints, log) {
  log(`🔍 Verifying fill...`);

  const readbackResults = await page.evaluate((acts) => {
    const results = [];
    for (const action of acts) {
      if (action.unanswered || action.action === "unanswered") continue;
      try {
        switch (action.action) {
          case "fill": {
            const el = document.querySelector(action.selector);
            if (!el) {
              results.push({ ...action, status: "NOT_FOUND", actual: null });
              break;
            }
            const match = el.value.trim() === String(action.value).trim();
            results.push({
              ...action,
              status: match ? "OK" : "MISMATCH",
              actual: el.value,
            });
            break;
          }
          case "select": {
            const el = document.querySelector(action.selector);
            if (!el) {
              results.push({ ...action, status: "NOT_FOUND", actual: null });
              break;
            }
            const selected = el.options[el.selectedIndex]?.text?.trim() ?? "";
            const match =
              selected.toLowerCase() === String(action.value).toLowerCase();
            results.push({
              ...action,
              status: match ? "OK" : "MISMATCH",
              actual: selected,
            });
            break;
          }
          case "radio": {
            const name = action.selector.match(/\[name="(.+?)"\]/)?.[1];
            if (!name) {
              results.push({ ...action, status: "NOT_FOUND", actual: null });
              break;
            }
            const radio = document.querySelector(
              `input[name="${name}"][value="${action.value}"]`,
            );
            if (!radio) {
              results.push({ ...action, status: "NOT_FOUND", actual: null });
              break;
            }
            results.push({
              ...action,
              status: radio.checked ? "OK" : "MISMATCH",
              actual: radio.checked,
            });
            break;
          }
          case "check": {
            const el = document.querySelector(action.selector);
            if (!el) {
              results.push({ ...action, status: "NOT_FOUND", actual: null });
              break;
            }
            const match = el.checked === Boolean(action.value);
            results.push({
              ...action,
              status: match ? "OK" : "MISMATCH",
              actual: el.checked,
            });
            break;
          }
        }
      } catch (e) {
        results.push({ ...action, status: "ERROR", actual: e.message });
      }
    }
    return results;
  }, actions);

  const ok = readbackResults.filter((r) => r.status === "OK");
  const mismatches = readbackResults.filter((r) => r.status !== "OK");

  log(`   ✅ ${ok.length} fields verified OK.`);
  if (mismatches.length > 0) {
    log(`   ⚠️  ${mismatches.length} mismatch(es) detected:`);
    for (const m of mismatches)
      log(
        `      [${m.status}] ${m.selector} — expected: "${m.value}" | actual: "${m.actual}"`,
      );
  }

  // Detect new conditional fields that appeared after filling
  const currentFingerprints = await page.evaluate(FINGERPRINT_FN);
  const knownSelectors = new Set(originalFingerprints.map((f) => f.selector));
  const newFields = currentFingerprints.filter(
    (f) => !knownSelectors.has(f.selector),
  );

  if (newFields.length > 0) {
    log(`   🆕 ${newFields.length} new conditional field(s) appeared:`);
    for (const f of newFields)
      log(`      → "${f.label || f.selector}" [${f.type}]`);
  } else {
    log(`   No new conditional fields detected.`);
  }

  return { mismatches, newFields };
}

// ─── Lever: navigate to the apply sub-page and wait for the form ──────────────
// FIX 3: Lever is a React SPA — form only exists at /apply sub-route
async function openLeverForm(page, url, log) {
  const base = url.split("#")[0].replace(/\/$/, "");
  const applyUrl = base.endsWith("/apply") ? base : `${base}/apply`;
  log(`🔗 Lever detected — navigating to apply page: ${applyUrl}`);
  await page.goto(applyUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  // Wait for a known Lever form field to confirm the form mounted
  try {
    await page.waitForSelector('input[name="name"], input[name="email"]', {
      timeout: 10000,
    });
    log(`   Lever form loaded.`);
  } catch {
    log(`⚠️  Lever form did not load in time — continuing anyway.`);
  }
}

// ─── Main agent ───────────────────────────────────────────────────────────────
export const runApplicationAgent = async (
  job,
  profile,
  io,
  sharedContext = null,
) => {
  const log = (msg) => io.emit("log", { message: `[APP AGENT]: ${msg}` });
  log(`🌐 Navigating to: ${job.url}`);

  // Use shared context if provided (keeps cookies/CAPTCHA tokens alive across jobs)
  const ownContext = !sharedContext;
  let context;
  try {
    context = sharedContext || (await launchBrowser("application"));
    const page = await context.newPage();

    const isLever = job.url.includes("jobs.lever.co");

    if (isLever) {
      // FIX 3: Go straight to the /apply sub-page
      await openLeverForm(page, job.url, log);
    } else {
      await page.goto(job.url, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await page.waitForTimeout(1500);
    }

    job.status = "ANALYZING_FORM";
    await job.save();

    // ── DOM Fingerprinting ────────────────────────────────────────────────
    log(`🔬 Fingerprinting DOM...`);
    const fingerprints = await page.evaluate(FINGERPRINT_FN);
    log(
      `   Found ${fingerprints.length} fields (inputs, selects, radios, checkboxes).`,
    );

    if (fingerprints.length === 0) {
      log(`❌ No form fields detected. Flagging for manual review.`);
      job.status = "MANUAL_REVIEW_NEEDED";
      await job.save();
      if (ownContext) await context.close();
      return;
    }

    // ── AI Mapping via Groq ───────────────────────────────────────────────
    log(`🤖 Sending fingerprint to Groq (${GROQ_MODEL})...`);
    job.status = "APPLYING";
    await job.save();

    let actions;
    try {
      actions = await mapFieldsWithGroq(fingerprints, profile, log);
    } catch (err) {
      log(`❌ Groq mapping failed: ${err.message}`);
      job.status = "FAILED_NEEDS_HEALING";
      job.lastKnownHtml = await page.content().catch(() => null);
      await job.save();
      if (ownContext) await context.close();
      return;
    }

    log(`   Groq returned ${actions.length} action(s).`);

    // ── Resume ────────────────────────────────────────────────────────────
    await attachResume(page, profile.resumePath, log);

    // ── Fill Fields ───────────────────────────────────────────────────────
    let needsHuman = await executeActions(page, actions, log);

    // ── Verify Fill ───────────────────────────────────────────────────────
    const { mismatches, newFields } = await verifyFill(
      page,
      actions,
      fingerprints,
      log,
    );

    // ── Retry mismatches once ─────────────────────────────────────────────
    if (mismatches.length > 0) {
      log(`🔄 Retrying ${mismatches.length} mismatch(es)...`);
      await executeActions(page, mismatches, log);
      const { mismatches: stillBroken } = await verifyFill(
        page,
        mismatches,
        fingerprints,
        log,
      );
      if (stillBroken.length > 0) {
        log(
          `⚠️  ${stillBroken.length} field(s) still wrong after retry — handing off to manual review.`,
        );
        needsHuman = true;
      } else {
        log(`✅ All mismatches resolved on retry.`);
      }
    }

    // ── Handle new conditional fields ─────────────────────────────────────
    // Adaptive learning will be wired here in the next session.
    if (newFields.length > 0) {
      log(
        `⚠️  Conditional fields appeared — flagging for manual review. (Adaptive learning coming soon)`,
      );
      needsHuman = true;
    }

    // ── Submit or hold ────────────────────────────────────────────────────
    if (needsHuman) {
      log(
        `⚠️  Holding browser open for 90s — complete remaining fields manually.`,
      );
      job.status = "MANUAL_REVIEW_NEEDED";
      await job.save();
      await new Promise((r) => setTimeout(r, 90000));
      if (ownContext) await context.close();
      return;
    }

    // ── SUBMIT DISABLED FOR TESTING ───────────────────────────────────────
    // To enable: uncomment the block below and remove the two lines after it.
    //
    // const submitBtn = await findSubmitButton(page);
    // if (!submitBtn) {
    //     log(`⚠️  Submit button not found — flagging for manual review.`);
    //     job.status = 'MANUAL_REVIEW_NEEDED';
    //     await job.save();
    //     await new Promise(r => setTimeout(r, 90000));
    //     await context.close();
    //     return;
    // }
    // log(`🚀 Submitting application...`);
    // await submitBtn.click();
    // await Promise.race([
    //     page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
    //     page.waitForTimeout(8000),
    // ]).catch(() => {});
    // const success = await detectSuccess(page);
    // if (success) { log(`✅ Application submitted successfully!`); }
    // else { log(`⚠️  No success signal detected. Marking APPLIED (unverified).`); job.lastKnownHtml = await page.content().catch(() => null); }

    log(
      `✅ Fields injected. Submit is disabled for testing — uncomment submit block to go live.`,
    );
    job.status = "APPLIED";

    await job.save();
    if (ownContext) await context.close();
  } catch (err) {
    log(`❌ Fatal error: ${err.message}`);
    job.status = "FAILED_NEEDS_HEALING";
    await job.save();
    if (ownContext && context) await context.close();
  }
};
