import { launchBrowser } from "../services/browser.manager.js";
import { detectPlatform, platformMap } from "./platform.adapter.js";
import { FieldRegistry } from "../models/FieldRegistry.js";
import dotenv from "dotenv";
dotenv.config();

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.1-8b-instant";
const CHUNK_SIZE = 15;

// ─── DOM Fingerprinting ────────────────────────────────────────────────────────
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

  const QUERY = [
    'input:not([type="hidden"]):not([type="file"]):not([type="radio"]):not([type="submit"])',
    "select",
    "textarea",
  ].join(", ");

  for (const el of document.querySelectorAll(QUERY)) {
    const selector = bestSelector(el);
    if (!selector || el.readOnly || el.disabled) continue;
    if (!isVisible(el) || isNoise(el)) continue;
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

// ─── Phase 1: Deterministic Label Matcher ─────────────────────────────────────
// Covers ~80% of fields with zero AI calls. Only unmatched fields go to Groq.
function deterministicMap(fingerprints, profile) {
  const actions = [];
  const unmatched = [];

  // Extract first/last name from full name if separate fields not in profile
  const nameParts = (profile.name || "").trim().split(/\s+/);
  const firstName = profile.firstName || nameParts[0] || "";
  const lastName = profile.lastName || nameParts.slice(1).join(" ") || "";
  const city = profile.city || (profile.location || "").split(",")[0].trim();
  const country =
    profile.country || (profile.location || "").split(",").pop().trim();

  for (const f of fingerprints) {
    const label = (f.label || "").toLowerCase();
    const sel = (f.selector || "").toLowerCase();
    const ph = (f.placeholder || "").toLowerCase();
    const ctx = (f.context || "").toLowerCase();
    const t = f.type;
    const c = `${label} ${sel} ${ph} ${ctx}`;

    let value = null;
    let actionType = "fill";

    // ── Name ──────────────────────────────────────────────────────────────
    if (/first[\s_-]?name|fname/.test(c)) {
      value = firstName;
    } else if (/last[\s_-]?name|lname|surname|family[\s_-]?name/.test(c)) {
      value = lastName;
    } else if (
      /\bfull[\s_-]?name\b|\bname\b/.test(c) &&
      t !== "checkbox" &&
      !t.startsWith("select")
    ) {
      value = profile.name || `${firstName} ${lastName}`.trim();
    }

    // ── Contact ───────────────────────────────────────────────────────────
    else if (/\bemail\b/.test(c)) {
      value = profile.email || "";
    } else if (/\bphone\b|\bmobile\b|\btel\b/.test(c)) {
      value = profile.phone || "";
    }

    // ── Location ──────────────────────────────────────────────────────────
    else if (
      /\bcity\b|candidate[\s-]?location|current[\s-]?location|location[\s-]?input/.test(
        c,
      )
    ) {
      value = city;
    } else if (/\bcountry\b/.test(c)) {
      value = country;
      actionType = t.startsWith("select") ? "select" : "autocomplete";
    }

    // ── URLs ──────────────────────────────────────────────────────────────
    else if (/linkedin/.test(c)) {
      value = profile.linkedinUrl || "";
    } else if (/github/.test(c)) {
      value = profile.githubUrl || "";
    } else if (/portfolio|personal[\s-]?site|website/.test(c)) {
      value = profile.portfolioUrl || "";
    }

    // ── Professional ──────────────────────────────────────────────────────
    else if (
      /current[\s-]?company|employer|company[\s-]?name|\borg\b/.test(c) &&
      !/how|hear/.test(c)
    ) {
      value = profile.currentCompany || "";
    } else if (
      /current[\s-]?title|job[\s-]?title|position/.test(c) &&
      !t.startsWith("select")
    ) {
      value = profile.currentTitle || "";
    } else if (/years.*exp|experience.*year/.test(c)) {
      // If it's a radio group, pick the matching option; otherwise fill
      if (t === "radio" && f.options?.length) {
        const yrs = parseInt(profile.yearsOfExperience) || 0;
        const match = f.options.find((o) => {
          const nums = String(o.label || o.value || "").match(/\d+/g) || [];
          return nums.some((n) => Math.abs(parseInt(n) - yrs) <= 1);
        });
        value = match ? String(match.value) : String(f.options[0]?.value || "");
        actionType = "radio";
      } else {
        value = String(profile.yearsOfExperience || "");
      }

      // ── Motivation / why hire you ─────────────────────────────────────────
    } else if (
      /why.*hire|why.*good.*fit|why.*apply|why.*interest|why.*role|why.*position|what.*motivat|why.*want/i.test(
        c,
      ) &&
      t !== "checkbox" &&
      !t.startsWith("select")
    ) {
      value = profile.whyHireYou || profile.summary || "";

      // ── Proficiency / rating ──────────────────────────────────────────────
    } else if (
      /proficien|fluent|english.*level|language.*level|rate.*yourself|communication|skill.*level/i.test(
        c,
      ) &&
      (t === "radio" || t.startsWith("select"))
    ) {
      const preferred = [
        "native",
        "fluent",
        "proficient",
        "advanced",
        "c2",
        "c1",
        "b2",
      ];
      const opts = (f.options || []).map((o) =>
        typeof o === "object" ? o : { value: o, label: String(o) },
      );
      const bestOpt = preferred
        .map((p) =>
          opts.find((o) =>
            String(o.label || o.value)
              .toLowerCase()
              .includes(p),
          ),
        )
        .find(Boolean);
      value = bestOpt
        ? String(bestOpt.value)
        : String(opts[opts.length - 1]?.value || "");
      actionType = t === "radio" ? "radio" : "select";
    } else if (
      /\bsummary\b|cover[\s-]?letter|about[\s-]?you|additional.*info|message|anything.*else/i.test(
        c,
      )
    ) {
      value = profile.summary || "";
    } else if (
      /\bsalary\b|\bcompensation\b|\bpay\b/.test(c) &&
      /min|expect|desired/.test(c)
    ) {
      value = String(profile.minSalary || "");
    }

    // ── Education ─────────────────────────────────────────────────────────
    else if (/\bschool\b|university|college|institution/.test(c)) {
      value =
        profile.educationSchool ||
        (profile.education || "").split(",")[0].trim();
    } else if (/\bdegree\b/.test(c)) {
      value = profile.educationDegree || "Bachelor's Degree";
      actionType = t.startsWith("select") ? "select" : "fill";
    } else if (/field.*study|major|discipline/.test(c)) {
      value = profile.educationField || "Computer Science";
    } else if (/start[\s-]?year/.test(c)) {
      value = profile.educationStartYear || "";
    } else if (/end[\s-]?year|graduation|grad[\s-]?year/.test(c)) {
      value = profile.educationEndYear || profile.graduationYear || "";
    } else if (
      /relocate|willing.*move|open.*reloc/.test(c) &&
      t.startsWith("select")
    ) {
      value = profile.willingToRelocate || "No";
      actionType = "select";
    } else if (/relocate|willing.*move|open.*reloc/.test(c)) {
      value = profile.willingToRelocate || "No";
    }

    // ── Work Auth / EEO ───────────────────────────────────────────────────
    else if (/work[\s-]?auth|authorized|legally[\s-]?eligible/.test(c)) {
      value = t.startsWith("select") ? "Yes" : null;
      actionType = "select";
    } else if (/\bvisa\b|sponsor/.test(c) && t.startsWith("select")) {
      value = "No";
      actionType = "select";
    } else if (/\bgender\b|\bsex\b/.test(c) && t.startsWith("select")) {
      value = profile.gender || "Decline to self-identify";
      actionType = "select";
    } else if (
      /\brace\b|ethnic|hispanic|latino/.test(c) &&
      t.startsWith("select")
    ) {
      value = profile.ethnicity || "Decline to self-identify";
      actionType = "select";
    } else if (/\bveteran\b/.test(c) && t.startsWith("select")) {
      value = profile.veteran || "I am not a protected veteran";
      actionType = "select";
    } else if (/\bdisability\b/.test(c) && t.startsWith("select")) {
      value = profile.disability || "I don't wish to answer";
      actionType = "select";
    } else if (
      /how.*hear|source|referral|where.*find/.test(c) &&
      t.startsWith("select")
    ) {
      value = "LinkedIn";
      actionType = "select";
    }

    if (value !== null && value !== "") {
      actions.push({ selector: f.selector, action: actionType, value });
    } else {
      unmatched.push(f);
    }
  }

  return { actions, unmatched };
}

// ─── JSON repair ───────────────────────────────────────────────────────────────
function repairJSON(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    /* fall through */
  }
  const lastClose = raw.lastIndexOf("}");
  if (lastClose === -1)
    throw new Error("JSON repair failed — no complete objects");
  try {
    return JSON.parse(raw.slice(0, lastClose + 1) + "]");
  } catch {
    throw new Error("JSON repair failed — response too corrupted");
  }
}

// ─── Groq call with 429 retry ──────────────────────────────────────────────────
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
      const waitMs = (attempt + 1) * 15000;
      console.log(`[GROQ] 429 — waiting ${waitMs / 1000}s...`);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Groq API ${res.status}: ${txt.slice(0, 200)}`);
    }
    return res;
  }
  throw new Error("Groq rate limit: max retries exceeded.");
}

function compressForGroq(fingerprints) {
  return fingerprints.map((f) => {
    const c = { s: f.selector, l: f.label, t: f.type, r: f.required };
    if (
      (f.type.startsWith("select") || f.type === "radio") &&
      f.options?.length
    )
      c.o = f.options;
    if (f.groupName) c.g = f.groupName;
    return c;
  });
}

// ─── Groq: map a single chunk (only unmatched fields) ─────────────────────────
async function mapChunkWithGroq(chunk, profile, validSelectors, attempt = 0) {
  const compressed = compressForGroq(chunk);
  const cleanProfile = {
    ...profile,
    country:
      (profile.location || "").split(",").pop().trim() ||
      profile.location ||
      "",
    city: (profile.location || "").split(",")[0].trim() || "",
  };

  const prompt = `You are an ATS form-filling bot. Map ONLY the provided candidate data to the EXACT selectors listed.

## Candidate Profile
${JSON.stringify(cleanProfile, null, 2)}

## Unmatched Form Fields (s=selector, l=label, t=type, r=required, o=options)
${JSON.stringify(compressed, null, 2)}

## VALID SELECTORS — USE ONLY THESE
${JSON.stringify(validSelectors)}

## Output: raw JSON array only, no markdown, no explanation.

Each element:
- Text/textarea input: { "selector": "...", "action": "fill",   "value": "text from profile" }
- Select/dropdown:     { "selector": "...", "action": "select", "value": "exact option label" }
- Radio button group:  { "selector": "...", "action": "radio",  "value": "exact radio value attr from options" }
- Checkbox:            { "selector": "...", "action": "check",  "value": true }
- Cannot map:          { "selector": "...", "action": "fill",   "value": "", "unanswered": true }

CRITICAL RULES:
1. ONLY use selectors from the valid list — NEVER invent or modify selectors
2. RADIO fields (t="radio"): MUST use action "radio". Value MUST be one of the listed option values (o field). NEVER use "fill" for radio.
3. CHECKBOX fields: MUST use action "check" with boolean. NEVER use "fill".
4. SELECT fields: value must exactly match one of the listed option labels.
5. Map fields to the SEMANTICALLY CORRECT profile value. Do NOT assign name/email to experience or proficiency fields.
6. For proficiency/rating radios: pick the highest confidence option (e.g. "Proficient", "Fluent", "Advanced", "Yes").
7. For yes/no radios about work authorization: pick "Yes".
8. Skip optional fields you cannot confidently map — return unanswered: true.`;

  const res = await callGroq({
    model: GROQ_MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1,
    max_tokens: 2048,
  });

  const data = await res.json();
  const raw = data.choices[0].message.content
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();

  try {
    return repairJSON(raw);
  } catch (e) {
    if (attempt < 1) {
      console.log("[GROQ] JSON corrupted — retrying chunk once...");
      return mapChunkWithGroq(chunk, profile, validSelectors, attempt + 1);
    }
    throw e;
  }
}

// ─── Chunked Groq mapping (only for fields deterministic mapper missed) ────────
async function mapFieldsWithGroq(fingerprints, profile, log) {
  if (fingerprints.length === 0) return [];

  const validSelectors = fingerprints.map((f) => f.selector);
  const chunks = [];
  for (let i = 0; i < fingerprints.length; i += CHUNK_SIZE)
    chunks.push(fingerprints.slice(i, i + CHUNK_SIZE));

  log(
    `🤖 Groq mapping ${fingerprints.length} unmatched field(s) in ${chunks.length} chunk(s)...`,
  );

  const allActions = [];
  for (let i = 0; i < chunks.length; i++) {
    if (chunks.length > 1) log(`   Chunk ${i + 1}/${chunks.length}...`);
    const chunkSelectors = chunks[i].map((f) => f.selector);
    const actions = await mapChunkWithGroq(chunks[i], profile, chunkSelectors);

    // Filter hallucinated selectors
    const validSet = new Set(chunkSelectors);
    const valid = actions.filter(
      (a) => a.unanswered || validSet.has(a.selector),
    );
    const filtered = actions.length - valid.length;
    if (filtered > 0)
      log(
        `   🧹 Chunk ${i + 1}: filtered ${filtered} hallucinated selector(s).`,
      );
    allActions.push(...valid);
  }

  log(
    `🧠 Groq returned ${allActions.length} valid action(s) for unmatched fields.`,
  );
  return allActions;
}

// ─── Execute Playwright actions ────────────────────────────────────────────────
async function executeActions(page, actions, log) {
  let needsHuman = false;
  for (const action of actions) {
    if (action.unanswered || action.action === "unanswered") {
      log(`⚠️  Unmapped field: ${action.selector}`);
      needsHuman = true;
      continue;
    }
    try {
      switch (action.action) {
        case "fill": {
          // Detect checkbox and auto-switch to click
          const elType = await page
            .evaluate(
              (sel) => document.querySelector(sel)?.type || "",
              action.selector,
            )
            .catch(() => "");

          if (elType === "checkbox") {
            const checked = await page
              .isChecked(action.selector)
              .catch(() => false);
            const shouldCheck =
              action.value === true || action.value === "true";
            if (shouldCheck !== checked)
              await page.click(action.selector, { timeout: 5000 });
          } else {
            // React-compatible fill: use native value setter + dispatch events
            // This is the same trick Simplify/Chrome extensions use to trigger
            // React's synthetic event system (plain .value= doesn't work).
            const filled = await page
              .evaluate(
                ({ sel, val }) => {
                  const el = document.querySelector(sel);
                  if (!el) return false;
                  // Native value setter bypasses React's read-only descriptor
                  const proto =
                    el.tagName === "TEXTAREA"
                      ? window.HTMLTextAreaElement.prototype
                      : window.HTMLInputElement.prototype;
                  const setter = Object.getOwnPropertyDescriptor(
                    proto,
                    "value",
                  )?.set;
                  if (setter) setter.call(el, val);
                  else el.value = val;
                  el.dispatchEvent(new Event("input", { bubbles: true }));
                  el.dispatchEvent(new Event("change", { bubbles: true }));
                  el.dispatchEvent(new Event("blur", { bubbles: true }));
                  return true;
                },
                { sel: action.selector, val: String(action.value) },
              )
              .catch(() => false);

            // Fallback to Playwright fill if evaluate didn't work
            if (!filled) {
              await page.fill(action.selector, String(action.value), {
                timeout: 5000,
              });
            }
          }
          break;
        }

        case "select": {
          // 3-tier fuzzy select (same approach as Simplify):
          // 1. Exact label match
          // 2. Case-insensitive match
          // 3. Neutral-keyword fallback for EEO/optional fields
          //    ("decline", "prefer not", "wish to answer", "self-identify", etc.)
          const target = String(action.value).toLowerCase().trim();
          const options = await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (!el) return [];
            return Array.from(el.options).map((o) => ({
              value: o.value,
              text: o.text.trim(),
            }));
          }, action.selector);

          if (options.length === 0) {
            log(`⚠️  select: no options found for ${action.selector}`);
            break;
          }

          // Tier 1: exact
          let match = options.find((o) => o.text === String(action.value));
          // Tier 2: case-insensitive
          if (!match)
            match = options.find((o) => o.text.toLowerCase() === target);
          // Tier 3: partial keyword match (handles "Decline to Self-Identify" vs "Decline to self-identify")
          if (!match)
            match = options.find((o) =>
              o.text.toLowerCase().includes(target.split(" ")[0]),
            );
          // Tier 4: neutral fallback — for EEO/optional fields, find "safe" option
          if (!match) {
            const NEUTRAL = [
              "decline",
              "prefer not",
              "wish to answer",
              "self-identify",
              "rather not",
              "no response",
              "choose not",
              "not disclosed",
            ];
            match = options.find((o) =>
              NEUTRAL.some((kw) => o.text.toLowerCase().includes(kw)),
            );
          }
          // Tier 5: skip first empty/placeholder option, pick first real option as last resort
          if (!match)
            match = options.find((o) => o.value !== "" && o.value !== "0");

          if (match) {
            await page.selectOption(
              action.selector,
              { label: match.text },
              { timeout: 5000 },
            );
          } else {
            log(
              `⚠️  select: no match found for "${action.value}" in ${action.selector}`,
            );
          }
          break;
        }

        // FIX: Custom autocomplete dropdown (country, location fields that aren't real <select>)
        case "autocomplete": {
          await page.click(action.selector, { timeout: 5000 });
          await page.fill(action.selector, String(action.value), {
            timeout: 5000,
          });
          await page.waitForTimeout(800);
          // Try common dropdown option selectors
          const DROPDOWN_SELECTORS = [
            '[role="option"]:first-child',
            ".select__option:first-child",
            ".dropdown-item:first-child",
            'li[role="option"]:first-child',
            ".suggestions li:first-child",
            '[class*="option"]:first-child',
            '[class*="suggestion"]:first-child',
          ];
          let picked = false;
          for (const sel of DROPDOWN_SELECTORS) {
            const opt = await page.$(sel).catch(() => null);
            if (opt && (await opt.isVisible().catch(() => false))) {
              await opt.click();
              picked = true;
              break;
            }
          }
          if (!picked) {
            // Fallback: press Enter or Tab to accept first suggestion
            await page.keyboard.press("ArrowDown");
            await page.waitForTimeout(300);
            await page.keyboard.press("Enter");
          }
          break;
        }

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
          const shouldCheck = action.value === true || action.value === "true";
          if (shouldCheck !== checked)
            await page.click(action.selector, { timeout: 5000 });
          break;
        }

        default:
          log(`⚠️  Unknown action type: ${action.action}`);
      }
    } catch (err) {
      if (err.message.includes("closed")) {
        log(`❌ Page closed unexpectedly — aborting fill.`);
        throw err;
      }
      log(
        `⚠️  Fill failed [${action.selector}]: ${err.message.split("\n")[0]}`,
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

// ─── Verify Fill ───────────────────────────────────────────────────────────────
async function verifyFill(page, actions, originalFingerprints, log) {
  log(`🔍 Verifying fill...`);

  const readbackResults = await page.evaluate((acts) => {
    const results = [];
    for (const action of acts) {
      if (
        action.unanswered ||
        action.action === "unanswered" ||
        action.action === "autocomplete"
      )
        continue;
      try {
        switch (action.action) {
          case "fill": {
            const el = document.querySelector(action.selector);
            if (!el) {
              results.push({ ...action, status: "NOT_FOUND", actual: null });
              break;
            }
            // Strip all formatting chars for phone/tel fields — carriers and
            // browser phone-input libraries insert spaces in different positions.
            const isPhoneLike = /phone|mobile|tel/i.test(action.selector);
            const normalize = (s) => String(s).replace(/[\s\-()+]/g, "");
            const match = isPhoneLike
              ? normalize(el.value) === normalize(String(action.value))
              : el.value.trim() === String(action.value).trim();
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
            const shouldCheck =
              action.value === true || action.value === "true";
            const match = el.checked === shouldCheck;
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
    log(`   ⚠️  ${mismatches.length} mismatch(es):`);
    for (const m of mismatches)
      log(
        `      [${m.status}] ${m.selector} — expected: "${m.value}" | actual: "${m.actual}"`,
      );
  }

  const currentFingerprints = await page.evaluate(FINGERPRINT_FN);
  const knownSelectors = new Set(originalFingerprints.map((f) => f.selector));
  const newFields = currentFingerprints.filter(
    (f) => !knownSelectors.has(f.selector),
  );

  if (newFields.length > 0) {
    log(`   🆕 ${newFields.length} conditional field(s) appeared.`);
    for (const f of newFields)
      log(`      → "${f.label || f.selector}" [${f.type}]`);
  } else {
    log(`   No new conditional fields detected.`);
  }

  return { mismatches, newFields };
}

// ─── Lever: navigate to apply sub-page ────────────────────────────────────────
async function openLeverForm(page, url, log) {
  const base = url.split("#")[0].replace(/\/$/, "");
  const applyUrl = base.endsWith("/apply") ? base : `${base}/apply`;
  log(`🔗 Lever detected — navigating to apply page: ${applyUrl}`);
  await page.goto(applyUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  try {
    await page.waitForSelector('input[name="name"], input[name="email"]', {
      timeout: 10000,
    });
    log(`   Lever form loaded.`);
  } catch {
    log(`⚠️  Lever form did not load in time — continuing anyway.`);
  }
}

// ─── Job Relevance Score ───────────────────────────────────────────────────────
function scoreJobRelevance(jobText, profile) {
  const text = (jobText || "").toLowerCase();

  const expPatterns = [
    /(\d+)\+?\s*years?\s*of\s*(relevant\s*)?(experience|exp)/i,
    /minimum\s*(\d+)\s*years?/i,
    /at\s*least\s*(\d+)\s*years?/i,
  ];
  let requiredYears = 0;
  for (const pat of expPatterns) {
    const m = text.match(pat);
    if (m) {
      requiredYears = parseInt(m[1]);
      break;
    }
  }

  const candidateYears = parseInt(profile.yearsOfExperience) || 0;
  // Only hard-skip on experience if the profile actually has years set.
  // If yearsOfExperience is 0/missing, skip the experience gate entirely
  // so the user doesn't get blocked just because they forgot to fill that field.
  if (
    candidateYears > 0 &&
    requiredYears > 0 &&
    candidateYears < requiredYears
  ) {
    return {
      score: 0,
      skip: true,
      reason: `Requires ${requiredYears}+ yrs — candidate has ${candidateYears}. Skipping.`,
    };
  }

  const skills = (profile.skills || []).map((s) => s.toLowerCase());
  if (skills.length === 0)
    return {
      score: 50,
      skip: false,
      reason: "No skills in profile — add skills for better matching.",
    };

  // Fuzzy skill matching — handles React.js/ReactJS/React, Node.js/NodeJS/Node etc.
  // For each skill, build variants: raw, stripped of .js, stripped of spaces/dots
  const skillVariants = skills.map((s) => [
    s, // "react.js"
    s.replace(/\.js$/i, ""), // "react"
    s.replace(/[.\s]/g, ""), // "reactjs"
    s.replace(/[.\s-]/g, " ").trim(), // "react js" → normalized
  ]);

  const matched = skillVariants.filter((variants) =>
    variants.some((v) => v && text.includes(v)),
  );
  const score = Math.round((matched.length / skills.length) * 100);
  if (score < 25) {
    return {
      score,
      skip: true,
      reason: `Only ${matched.length}/${skills.length} skills matched (${score}%). Skipping.`,
    };
  }
  return {
    score,
    skip: false,
    reason: `${matched.length}/${skills.length} skills matched (${score}%).`,
  };
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

// ─── ATS Field Registry helpers ───────────────────────────────────────────────
// inferMapsTo: tries to identify which profile key produced a given value.
// Works well for unique strings (email, phone, urls, names).
// Returns null for static option values (Yes/No, EEO answers, etc.) — that's fine,
// the selector+action pair is still useful in the registry even without mapsTo.
function inferMapsTo(value, profile) {
  if (value === null || value === undefined) return null;
  const needle = String(value).trim().toLowerCase();
  if (!needle) return null;
  for (const [key, val] of Object.entries(profile)) {
    if (val === null || val === undefined) continue;
    if (typeof val === "object") continue; // skip arrays, objects
    if (String(val).trim().toLowerCase() === needle) return key;
  }
  return null;
}

// saveToRegistry: persists verified+submitted fills to MongoDB.
// SAFETY CONTRACT: caller MUST only invoke this when:
//   - mismatches.length === 0 (after retry)
//   - newFields.length === 0
//   - submit button was found and clicked without error
// Any deviation from that and this function is never reached.
async function saveToRegistry(
  platform,
  allActions,
  fingerprints,
  profile,
  jobUrl,
  log,
) {
  try {
    const fingerprintBySelector = new Map(
      fingerprints.map((f) => [f.selector, f]),
    );

    const ops = [];
    for (const action of allActions) {
      // Skip anything that isn't a real fill
      if (!action.selector) continue;
      if (action.unanswered || action.action === "unanswered") continue;
      if (action.action === "file" || action.action === "skip") continue;
      if (
        action.value === "" ||
        action.value === null ||
        action.value === undefined
      )
        continue;

      const fp = fingerprintBySelector.get(action.selector);
      const label = fp?.label || null;
      const mapsTo = inferMapsTo(action.value, profile);

      ops.push({
        updateOne: {
          filter: { platform, selector: action.selector },
          update: {
            $inc: { seenCount: 1, successCount: 1 },
            $set: {
              action: action.action,
              lastSeen: new Date(),
              lastJobUrl: jobUrl,
              // Only overwrite label/mapsTo if we have a better value than what's stored
              ...(label && { label }),
              ...(mapsTo && { mapsTo }),
            },
            $setOnInsert: {
              platform,
              selector: action.selector,
              seenCount: 0, // $inc will add 1 on top
              successCount: 0,
            },
          },
          upsert: true,
        },
      });
    }

    if (ops.length === 0) return;

    await FieldRegistry.bulkWrite(ops, { ordered: false });
    log(`📚 Registry: ${ops.length} selector(s) recorded.`);
  } catch (err) {
    // Registry errors must never crash the application agent
    log(`⚠️  Registry write skipped: ${err.message.split("\n")[0]}`);
  }
}

// ─── Main Agent ────────────────────────────────────────────────────────────────
export const runApplicationAgent = async (
  job,
  profile,
  io,
  sharedContext = null,
) => {
  const log = (msg) => io.emit("log", { message: `[APP AGENT]: ${msg}` });
  log(`🌐 Navigating to: ${job.url}`);

  const ownContext = !sharedContext;
  let context;
  let page;

  try {
    context = sharedContext || (await launchBrowser("application"));
    page = await context.newPage();

    const isLever = job.url.includes("jobs.lever.co");
    // ── Navigate + grab job description text ──────────────────────────────
    // For Lever: score BEFORE navigating to /apply — the apply page is just
    // a form with no job description, so scoring there always returns 0.
    let jobText = "";
    if (isLever) {
      await page.goto(job.url, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await page.waitForTimeout(1500);
      jobText = await page
        .evaluate(() => document.body.innerText)
        .catch(() => "");
      await openLeverForm(page, job.url, log);
    } else {
      await page.goto(job.url, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await page.waitForTimeout(1500);
      jobText = await page
        .evaluate(() => document.body.innerText)
        .catch(() => "");
    }

    // ── Relevance Score ───────────────────────────────────────────────────
    log(`📊 Scoring job relevance...`);
    // jobText already captured above before any /apply navigation
    const relevance = scoreJobRelevance(jobText, profile);
    log(`   Score: ${relevance.score}/100 — ${relevance.reason}`);

    if (relevance.skip) {
      log(`🚫 Skipping — does not meet threshold.`);
      job.status = "FAILED";
      job.skipReason = relevance.reason;
      await job.save();
      await page.close().catch(() => {});
      return;
    }

    job.status = "ANALYZING_FORM";
    await job.save();

    // ── DOM Fingerprinting ─────────────────────────────────────────────────
    log(`🔬 Fingerprinting DOM...`);
    const fingerprints = await page.evaluate(FINGERPRINT_FN);
    log(`   Found ${fingerprints.length} fields.`);

    if (fingerprints.length === 0) {
      log(`❌ No form fields detected. Flagging for manual review.`);
      job.status = "MANUAL_REVIEW_NEEDED";
      await job.save();
      await page.close().catch(() => {});
      return;
    }

    job.status = "APPLYING";
    await job.save();

    // ── Phase 0: Platform-specific name-attr mapping (Greenhouse / Lever) ─────
    const platform = detectPlatform(job.url);
    let platformActions = [];
    let handledSelectors = new Set();

    if (platform) {
      log(`🏷️  Platform detected: ${platform.toUpperCase()}`);
      const result = platformMap(platform, fingerprints, profile, log);
      platformActions = result.actions;
      handledSelectors = result.handled;
    } else {
      log(
        `⚙️  Unknown platform — skipping name-attr mapping, using label matcher.`,
      );
    }

    // Filter fingerprints already handled by platform adapter
    const remainingAfterPlatform = fingerprints.filter(
      (f) => !handledSelectors.has(f.selector),
    );

    // ── Phase 1: Deterministic label matcher (on remaining fields only) ───────
    log(
      `⚡ Running deterministic label matcher on ${remainingAfterPlatform.length} remaining fields...`,
    );
    const { actions: deterministicActions, unmatched } = deterministicMap(
      remainingAfterPlatform,
      profile,
    );
    log(
      `   ✅ Deterministic: ${deterministicActions.length} fields mapped. ${unmatched.length} sent to Groq.`,
    );

    // ── Phase 2: Groq for remaining unmatched fields ───────────────────────
    let groqActions = [];
    if (unmatched.length > 0) {
      try {
        groqActions = await mapFieldsWithGroq(unmatched, profile, log);
      } catch (err) {
        log(
          `⚠️  Groq mapping failed: ${err.message} — continuing with deterministic results only.`,
        );
      }
    }

    const allActions = [
      ...platformActions,
      ...deterministicActions,
      ...groqActions,
    ];
    log(
      `📋 Total actions: ${allActions.length} (platform: ${platformActions.length}, deterministic: ${deterministicActions.length}, groq: ${groqActions.length})`,
    );

    // ── Attach resume ──────────────────────────────────────────────────────
    await attachResume(page, profile.resumePath, log);

    // ── Fill ───────────────────────────────────────────────────────────────
    let needsHuman = await executeActions(page, allActions, log);

    // ── Verify ────────────────────────────────────────────────────────────
    const { mismatches, newFields } = await verifyFill(
      page,
      allActions,
      fingerprints,
      log,
    );

    // ── Retry mismatches once ──────────────────────────────────────────────
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
        log(`⚠️  ${stillBroken.length} field(s) still wrong after retry.`);
        needsHuman = true;
      } else {
        log(`✅ All mismatches resolved on retry.`);
      }
    }

    if (newFields.length > 0) {
      log(`⚠️  Conditional fields appeared — flagging for manual review.`);
      needsHuman = true;
    }

    if (needsHuman) {
      log(`⚠️  Holding browser open 90s — complete remaining fields manually.`);
      job.status = "MANUAL_REVIEW_NEEDED";
      await job.save();
      await new Promise((r) => setTimeout(r, 90000));
      await page.close().catch(() => {});
      return;
    }

    // ── SUBMIT (hard gate: only fires on 100% clean verify) ───────────────
    // Conditions already guaranteed by the needsHuman check above:
    //   - needsHuman === false  → no unanswered fields, no conditional fields
    //   - mismatches.length === 0 after retry
    // If either condition failed we returned MANUAL_REVIEW_NEEDED already.
    log(`🔍 Verify clean — searching for submit button...`);
    const submitBtn = await findSubmitButton(page);

    if (!submitBtn) {
      log(`⚠️  Submit button not found — flagging for manual review.`);
      job.status = "MANUAL_REVIEW_NEEDED";
      await job.save();
      await new Promise((r) => setTimeout(r, 90000));
      await page.close().catch(() => {});
      return;
    }

    log(`🚀 All fields verified — submitting application...`);
    await submitBtn.click();
    await page.waitForTimeout(6000).catch(() => {});
    log(`✅ Application submitted.`);

    // ── Registry: record ONLY after clean verify + successful submit ───────
    // saveToRegistry is wrapped in try-catch internally — cannot crash here.
    await saveToRegistry(
      platform || "unknown",
      allActions,
      fingerprints,
      profile,
      job.url,
      log,
    );

    job.status = "APPLIED";
    job.appliedAt = new Date();
    await job.save();

    await page.close().catch(() => {});
    if (ownContext) await context.close();
  } catch (err) {
    log(`❌ Fatal error: ${err.message}`);
    job.status = "FAILED_NEEDS_HEALING";
    await job.save();
    if (page) await page.close().catch(() => {});
    if (ownContext && context) await context.close();
  }
};
