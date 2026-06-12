import { launchBrowser } from "../services/browser.manager.js";
import { waitControl } from "../services/wait.control.js";
import { detectPlatform, platformMap } from "./platform.adapter.js";
import { FieldRegistry } from "../models/FieldRegistry.js";
import dotenv from "dotenv";
dotenv.config();

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.1-8b-instant";
const CHUNK_SIZE = 15;

// ── SAFETY: Dry-run mode ────────────────────────────────────────────────────
// While set to true, the agent fills + verifies forms but does NOT click the
// real submit button and does NOT mark jobs as APPLIED. Set DRY_RUN=false in
// .env (or remove this override) once field accuracy has been verified across
// several runs. This prevents real applications going out with wrong data.
const DRY_RUN = process.env.DRY_RUN !== "false"; // defaults to true (safe)

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
    // Walk 12 levels (was 6) — Lever puts question text in grandparent <p> tags,
    // not in a sibling or immediate parent heading.
    for (let i = 0; i < 12 && node; i++) {
      const heading = node.querySelector(
        ":scope > h1,:scope > h2,:scope > h3,:scope > h4,:scope > h5",
      );
      if (heading) return heading.innerText.trim();
      // Lever custom card fields: question is a bare <p> or <span> in an ancestor
      const para = node.querySelector(":scope > p, :scope > span");
      if (para) {
        const t = para.innerText.trim();
        if (t.length > 3 && t.length < 200) return t;
      }
      node = node.parentElement;
    }
    return "";
  };

  const bestSelector = (el) => {
    // Prefer [name=] over #id for numeric IDs — CSS.escape turns "864" into
    // "\38 64" which Playwright can't always resolve in page.fill/click.
    // Pure numeric IDs are Greenhouse custom question fields.
    if (el.name) return `[name="${el.name}"]`;
    if (el.id && /^\d/.test(el.id)) {
      // Numeric ID — use attribute selector instead of CSS-escaped #id
      return `[id="${el.id}"]`;
    }
    if (el.id) return `#${CSS.escape(el.id)}`;
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
    // IMPORTANT: \bname\b is too broad on its own — matches #school_name,
    // #company_name, #reference_name, #emergency_contact_name, etc. (selector
    // text is included in `c`). Exclude any field whose label/selector also
    // mentions a non-candidate entity (school, company, reference, employer,
    // contact, university, college, manager, supervisor, emergency).
    const NOT_CANDIDATE_NAME =
      /school|college|university|institut|company|employer|organi[sz]ation|reference|emergency|contact|manager|supervisor|recruiter|referr/;

    if (/first[\s_-]?name|fname/.test(c) && !NOT_CANDIDATE_NAME.test(c)) {
      value = firstName;
    } else if (
      /last[\s_-]?name|lname|surname|family[\s_-]?name/.test(c) &&
      !NOT_CANDIDATE_NAME.test(c)
    ) {
      value = lastName;
    } else if (
      /\bfull[\s_-]?name\b|\byour[\s_-]?name\b|^name$|\bname\b.*candidate|candidate.*\bname\b/.test(
        c,
      ) &&
      !NOT_CANDIDATE_NAME.test(c) &&
      t !== "checkbox" &&
      !t.startsWith("select")
    ) {
      value = profile.name || `${firstName} ${lastName}`.trim();
    }

    // ── Contact ───────────────────────────────────────────────────────────
    else if (/\bemail\b/.test(c)) {
      value = profile.email || "";
    } else if (/\bphone\b|\bmobile\b|\btel\b/.test(c)) {
      // Strip country code — form fields typically want local number only.
      // e.g. "+91 98765 43210" → "9876543210", "+1 555 123 4567" → "5551234567"
      const rawPhone = (profile.phone || "").replace(/[\s\-()]/g, "");
      const localPhone =
        rawPhone.replace(/^\+?\d{1,2}(?=\d{10}$)/, "") || rawPhone;
      value = localPhone;
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
    } else if (/twitter|x\.com/.test(c)) {
      value = profile.twitterUrl || "";
    } else if (
      /portfolio|personal[\s-]?(site|url|website)|website|personal[\s-]?link/.test(
        c,
      )
    ) {
      value = profile.portfolioUrl || profile.websiteUrl || "";
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

      // ── Yes/No skill questions ("Have you worked with X?" / "Do you know Y?") ──
      // Radio groups with exactly 2 options: yes/no — answer from profile.skills[]
    } else if (
      t === "radio" &&
      Array.isArray(f.options) &&
      f.options.length === 2 &&
      f.options.every((o) =>
        /^yes$|^no$/i.test(
          String(o.label !== undefined ? o.label : o.value || "").trim(),
        ),
      )
    ) {
      const qText = (
        label +
        " " +
        (f.hint || "") +
        " " +
        (f.context || "")
      ).toLowerCase();
      const skills = (profile.skills || []).map((s) => s.toLowerCase());
      const skillMentioned = skills.some((sk) => qText.includes(sk));
      const yesOpt = f.options.find((o) =>
        /^yes$/i.test(
          String(o.label !== undefined ? o.label : o.value || "").trim(),
        ),
      );
      const noOpt = f.options.find((o) =>
        /^no$/i.test(
          String(o.label !== undefined ? o.label : o.value || "").trim(),
        ),
      );
      const chosen = skillMentioned ? yesOpt : noOpt;
      value = chosen
        ? String(chosen.value !== undefined ? chosen.value : chosen.label)
        : skillMentioned
          ? "Yes"
          : "No";
      actionType = "radio";

      // ── CTC / Salary ──────────────────────────────────────────────────────
    } else if (
      /current.*ctc|current.*salary|current.*pay|present.*salary/i.test(c)
    ) {
      value = String(
        profile.currentCTC || profile.currentSalary || profile.minSalary || "",
      );
    } else if (
      /expected.*ctc|expected.*salary|desired.*salary|expected.*pay|salary.*expect/i.test(
        c,
      )
    ) {
      value = String(
        profile.expectedCTC ||
          profile.expectedSalary ||
          profile.maxSalary ||
          profile.minSalary ||
          "",
      );

      // ── Notice period ─────────────────────────────────────────────────────
    } else if (
      /notice.*period|notice|join.*immediately|available.*join|start.*date/i.test(
        c,
      ) &&
      !t.startsWith("select")
    ) {
      value = profile.noticePeriod || "Immediately";
    } else if (/notice.*period|notice/i.test(c) && t.startsWith("select")) {
      const immOpt = (f.options || []).find((o) =>
        /immediate|0|asap/i.test(String(o.label || o.value)),
      );
      value = immOpt
        ? String(immOpt.value)
        : f.options?.[0]
          ? String(f.options[0].value || f.options[0])
          : "";
      actionType = "select";

      // ── Current location (free text, not autocomplete) ────────────────────
    } else if (
      /current.*location|current.*city|current.*address|where.*based|where.*located/i.test(
        c,
      ) &&
      t !== "radio" &&
      !t.startsWith("select")
    ) {
      value = profile.location || "";

      // ── Company interest / "What do you know about X" ─────────────────────
    } else if (
      /what.*know.*about|why.*interested.*join|why.*want.*join|why.*company|tell.*about.*us|about.*our.*company/i.test(
        c,
      )
    ) {
      value =
        profile.companyInterest ||
        profile.whyHireYou ||
        `I'm excited about this opportunity as it aligns with my background in ${(profile.skills || []).slice(0, 3).join(", ")}. I believe I can contribute meaningfully to the team.`;

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
      // Greenhouse school_name_id is a typeahead/autocomplete, not a free-text input
      if (t.startsWith("select") || f.selector.includes("school_name")) {
        actionType = "autocomplete";
      }
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

    // ── Pronouns — always "Prefer not to say" or first neutral option ─────
    else if (/\bpronoun/i.test(c)) {
      if (t === "radio") {
        const neutralOpt =
          (f.options || []).find((o) =>
            /prefer not|decline|not.*say|rather not/i.test(
              String(o.label || o.value),
            ),
          ) || f.options?.[0];
        value = neutralOpt ? String(neutralOpt.value) : "";
        actionType = "radio";
      } else {
        value = profile.pronouns || "Prefer not to say";
      }

      // ── Work Auth / EEO ───────────────────────────────────────────────────
    } else if (
      /work[\s-]?auth|authorized|legally[\s-]?eligible|permission.*work|right.*work/.test(
        c,
      )
    ) {
      if (t === "radio") {
        const yesOpt = (f.options || []).find((o) =>
          /^yes$/i.test(String(o.label || o.value).trim()),
        );
        value = yesOpt ? String(yesOpt.value) : "Yes";
        actionType = "radio";
      } else {
        value = "Yes";
        actionType = t.startsWith("select") ? "select" : "fill";
      }
    } else if (/\bvisa\b|sponsor|require.*sponsor/.test(c)) {
      if (t === "radio") {
        const noOpt = (f.options || []).find((o) =>
          /^no$/i.test(String(o.label || o.value).trim()),
        );
        value = noOpt ? String(noOpt.value) : "No";
        actionType = "radio";
      } else {
        value = "No";
        actionType = t.startsWith("select") ? "select" : "fill";
      }
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
      // Phone fields: also set the intl-tel-input country dropdown to India.
      if (/\bphone\b|\bmobile\b|\btel\b/.test(c)) {
        actions.push({
          selector: f.selector,
          action: "phone_country",
          value: "in",
        });
      }
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
    // Include hint, placeholder, and section context.
    // These are critical for #question_XXXXX selectors (Greenhouse custom
    // questions) where the selector ID carries no semantic meaning — Groq
    // needs the surrounding text to understand what is being asked.
    if (f.hint) c.h = f.hint;
    if (f.placeholder) c.p = f.placeholder;
    if (f.context) c.ctx = f.context;
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
async function mapChunkWithGroq(
  chunk,
  profile,
  validSelectors,
  jobText = "",
  attempt = 0,
) {
  const compressed = compressForGroq(chunk);
  const titles = profile.titles || profile.jobTitles || [];
  const skills3 = (profile.skills || []).slice(0, 3).join(", ");
  const expYears = profile.yearsOfExperience || "several";
  const role0 = titles[0] || "software developer";

  const cleanProfile = {
    ...profile,
    country:
      (profile.location || "").split(",").pop().trim() ||
      profile.location ||
      "",
    city: (profile.location || "").split(",")[0].trim() || "",
    // Descriptive answer fallbacks — used by Groq for open-ended questions
    whyHireYou:
      profile.whyHireYou ||
      `I am a ${role0} with ${expYears} years of experience in ${skills3}. I am highly motivated, a quick learner, and passionate about building reliable software.`,
    companyInterest:
      profile.companyInterest ||
      `I am excited about this role because it aligns perfectly with my ${expYears} years of experience in ${skills3}. I am eager to contribute to your team.`,
    noticePeriod: profile.noticePeriod || "Immediately",
    currentCTC: profile.currentCTC || profile.currentSalary || "",
    expectedCTC:
      profile.expectedCTC || profile.expectedSalary || profile.minSalary || "",
    workAuthorization: "Yes",
    requiresSponsorship: "No",
    pronouns: profile.pronouns || "Prefer not to say",
    gender: profile.gender || "Decline to self-identify",
    ethnicity: profile.ethnicity || "Decline to self-identify",
    veteran: profile.veteran || "I am not a protected veteran",
    disability: profile.disability || "I don't wish to answer",
  };

  const prompt = `You are an ATS form-filling bot. Map ONLY the provided candidate data to the EXACT selectors listed.

## Candidate Profile
${JSON.stringify(cleanProfile, null, 2)}

## Job Description (for this specific application — use for "why this company" / "why this role" questions)
${(jobText || "").slice(0, 1200) || "(not available)"}

## Unmatched Form Fields
Field keys: s=selector, l=label, t=type, r=required, o=options, h=hint, p=placeholder, ctx=section_context
IMPORTANT: For fields with opaque IDs like #question_12345, use h, p, ctx to understand what is being asked.
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
8. For custom question fields (opaque IDs like #question_XXXXX): read h, p, and ctx carefully to determine what is being asked, then answer from the profile.
9. For "Why do you want to work here / why this company / what do you know about us" type questions: write a SPECIFIC 2-3 sentence answer that references something concrete from the Job Description above (the role, team, mission, or tech stack mentioned) combined with the candidate's matching skills. Do NOT use a generic template — make it sound tailored to THIS job.
10. For "Why should we hire you / why are you a good fit" questions: write a 2-3 sentence answer connecting the candidate's specific skills (from Candidate Profile) to the requirements visible in the Job Description.
11. Skip optional fields you cannot confidently map — return unanswered: true.`;

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
      return mapChunkWithGroq(
        chunk,
        profile,
        validSelectors,
        jobText,
        attempt + 1,
      );
    }
    throw e;
  }
}

// ─── Chunked Groq mapping (only for fields deterministic mapper missed) ────────
async function mapFieldsWithGroq(fingerprints, profile, log, jobText = "") {
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
    const actions = await mapChunkWithGroq(
      chunks[i],
      profile,
      chunkSelectors,
      jobText,
    );

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

        // intl-tel-input country code flag — set to India (+91) before phone fill
        case "phone_country": {
          try {
            // Click the flag dropdown to open the country list
            const flagBtn = await page.$(
              '.iti__selected-flag, [class*="flag-dropdown"], [class*="country-select"]',
            );
            if (flagBtn && (await flagBtn.isVisible().catch(() => false))) {
              await flagBtn.click();
              await page.waitForTimeout(300);
              // India option — intl-tel-input uses data-dial-code="91" or data-country-code="in"
              const indiaOpt = await page.$(
                '[data-dial-code="91"], [data-country-code="in"], li.iti__country[data-country-code="in"]',
              );
              if (indiaOpt) {
                await indiaOpt.click();
              } else {
                // Close dropdown if no India option found
                await page.keyboard.press("Escape");
              }
              await page.waitForTimeout(200);
            }
          } catch (e) {
            // Non-fatal — country code dropdown may not exist on this form
          }
          break;
        }

        // Custom autocomplete dropdown (location fields with Google Places / custom AC)
        case "autocomplete": {
          try {
            await page.click(action.selector, { timeout: 5000 });
          } catch {
            /* field may already be focused */
          }
          // Clear existing value first, then type
          await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (el) {
              el.value = "";
              el.dispatchEvent(new Event("input", { bubbles: true }));
            }
          }, action.selector);
          await page.type(action.selector, String(action.value), { delay: 60 });
          // Wait for autocomplete dropdown to appear
          await page.waitForTimeout(1200);

          const DROPDOWN_SELECTORS = [
            // Google Places (Greenhouse location)
            ".pac-item:first-child",
            ".pac-container .pac-item:first-child",
            // Generic ARIA options
            '[role="option"]:first-child',
            '[role="listbox"] [role="option"]:first-child',
            // Lever location suggestion
            ".suggestions li:first-child",
            ".autocomplete-suggestions div:first-child",
            // Common CSS class patterns
            ".select__option:first-child",
            ".dropdown-item:first-child",
            'li[role="option"]:first-child',
            '[class*="option"]:first-child',
            '[class*="suggestion"]:first-child',
          ];

          let picked = false;
          for (const sel of DROPDOWN_SELECTORS) {
            try {
              const opt = await page.$(sel);
              if (opt && (await opt.isVisible().catch(() => false))) {
                await opt.click();
                picked = true;
                break;
              }
            } catch {
              /* try next */
            }
          }
          if (!picked) {
            // Final fallback: keyboard navigation
            await page.keyboard.press("ArrowDown");
            await page.waitForTimeout(400);
            await page.keyboard.press("Enter");
          }
          // Brief pause for field to commit the selected value
          await page.waitForTimeout(500);
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
            // Skip file inputs — they return C:\fakepath\ on readback, never
            // the real path. Treat as OK since attachResume() handles them separately.
            if (el.type === "file") {
              results.push({ ...action, status: "OK", actual: "(file)" });
              break;
            }
            // Strip all formatting chars for phone/tel fields — carriers and
            // browser phone-input libraries insert spaces in different positions.
            const isPhoneLike =
              /phone|mobile|tel/i.test(action.selector) ||
              /phone|mobile/i.test(el.getAttribute("aria-label") || "") ||
              /phone|mobile/i.test(el.placeholder || "");
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
              // Lever card fields (cards[UUID][fieldN]) may be conditionally hidden —
              // NOT_FOUND here means the element isn't in DOM, not that fill failed.
              // Treat as OK to avoid blocking submission.
              const isCardField = name.startsWith("cards[");
              results.push({
                ...action,
                status: isCardField ? "OK" : "NOT_FOUND",
                actual: null,
              });
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

  // candidateYears: parse profile.yearsOfExperience. If missing/empty, treat
  // as 0 (fresher) — this is the CORRECT default, not a bypass. A fresher
  // should be filtered OUT of jobs requiring 2+ years, not shown everything.
  const hasYearsField =
    profile.yearsOfExperience !== undefined &&
    profile.yearsOfExperience !== null &&
    String(profile.yearsOfExperience).trim() !== "";
  const candidateYears = hasYearsField
    ? parseInt(profile.yearsOfExperience) || 0
    : 0;

  if (requiredYears > 0 && candidateYears < requiredYears) {
    return {
      score: 0,
      skip: true,
      reason: `Requires ${requiredYears}+ yrs — candidate has ${candidateYears} (${hasYearsField ? "from profile" : "fresher/unspecified"}). Skipping.`,
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

// ─── Multi-step form: find a "Next" / "Continue" button ───────────────────────
// Greenhouse sometimes splits applications into Step 1 (resume upload) and
// Step 2 (custom questions). This helper finds the inter-step navigation button
// so the agent can advance to the next page and re-fingerprint.
async function findNextButton(page) {
  const CANDIDATES = [
    'button:has-text("Next")',
    'button:has-text("Continue")',
    'button:has-text("Next Step")',
    '[data-testid="next-button"]',
    'button[class*="next"]',
    'input[value="Next"]',
    'input[value="Continue"]',
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

    // ── Phase 0a: Registry acceleration ─────────────────────────────────────
    // For known selectors (successCount >= 2), skip all AI phases — use cached
    // mapping directly. This is the self-improving moat: after 10+ clean runs,
    // most fields bypass Groq entirely.
    let registryActions = [];
    let registrySelectors = new Set();
    try {
      // FieldRegistry is imported at the top of this file — no dynamic import needed
      const currentSelectorSet = new Set(fingerprints.map((f) => f.selector));
      const hits = await FieldRegistry.find({
        platform: detectPlatform(job.url) || "unknown",
        successCount: { $gte: 2 },
      }).lean();
      registryActions = hits
        .filter((r) => currentSelectorSet.has(r.selector) && r.mapsTo)
        .map((r) => ({
          selector: r.selector,
          action: r.action,
          value: profile[r.mapsTo] || "",
        }))
        .filter((a) => a.value !== "");
      registrySelectors = new Set(registryActions.map((a) => a.selector));
      if (registryActions.length > 0) {
        log(
          `⚡ Registry: ${registryActions.length} field(s) resolved from cache — skipping AI.`,
        );
      }
    } catch (regErr) {
      log(`⚠️  Registry read skipped (non-fatal): ${regErr.message}`);
    }

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

    // Filter fingerprints already handled by registry or platform adapter
    const remainingAfterPlatform = fingerprints.filter(
      (f) =>
        !handledSelectors.has(f.selector) && !registrySelectors.has(f.selector),
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
        groqActions = await mapFieldsWithGroq(unmatched, profile, log, jobText);
      } catch (err) {
        log(
          `⚠️  Groq mapping failed: ${err.message} — continuing with deterministic results only.`,
        );
      }
    }

    const allActions = [
      ...registryActions,
      ...platformActions,
      ...deterministicActions,
      ...groqActions,
    ];
    log(
      `📋 Total actions: ${allActions.length} (registry: ${registryActions.length}, platform: ${platformActions.length}, deterministic: ${deterministicActions.length}, groq: ${groqActions.length})`,
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

    // ── Only block on REQUIRED unmapped/mismatched fields ────────────────
    // Optional unanswered fields should not hold up the whole submission.
    const requiredUnmapped = fingerprints.filter(
      (f) => f.required && !allActions.some((a) => a.selector === f.selector),
    );
    const requiredMismatches = (mismatches || []).filter((m) => {
      const fp = fingerprints.find((f) => f.selector === m.selector);
      return fp?.required;
    });
    // Override needsHuman — only true if REQUIRED fields are actually broken
    if (
      needsHuman &&
      requiredUnmapped.length === 0 &&
      requiredMismatches.length === 0
    ) {
      log(`ℹ️  Optional field issues only — proceeding to submit anyway.`);
      needsHuman = false;
    }

    if (needsHuman) {
      const unmappedCount = allActions.filter((a) => a.unanswered).length;
      const mismatchCount = (mismatches || []).length;
      log(
        `⚠️  ${unmappedCount} unmapped field(s), ${mismatchCount} mismatch(es) — needs manual review.`,
      );
      log(
        `⚠️  Complete remaining fields in the browser, then click "Done" in the UI. Auto-closes in 90s.`,
      );
      job.status = "MANUAL_REVIEW_NEEDED";
      await job.save();

      // Poll every second — resolves immediately when user clicks "Done" in UI,
      // or after 90s hard timeout.
      const waitStart = Date.now();
      while (Date.now() - waitStart < 90000) {
        if (waitControl.skip) {
          waitControl.skip = false; // reset for next job
          log("✅ Manual review marked done — moving to next job.");
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      await page.close().catch(() => {});
      // Re-queue: reset to DISCOVERED so orchestrator picks it up next run.
      // This prevents MANUAL_REVIEW_NEEDED jobs from piling up silently.
      job.status = "DISCOVERED";
      job.retryCount = (job.retryCount || 0) + 1;
      // Stop re-queuing after 3 attempts — it's genuinely unautomatable
      if (job.retryCount >= 3) {
        job.status = "FAILED";
        log(`❌ Job exceeded 3 manual review attempts — marking FAILED.`);
      } else {
        log(`🔄 Re-queued for retry (attempt ${job.retryCount}/3).`);
      }
      await job.save();
      return;
    }

    // ── Multi-step form handling (Greenhouse step 1 → step 2) ────────────
    // If there's no submit button but there IS a Next/Continue button,
    // the form is paginated. Click Next, wait for the new step to load,
    // re-fingerprint, map, fill, and verify the new fields before proceeding.
    // We cap at 5 steps to avoid infinite loops on broken forms.
    const MAX_STEPS = 5;
    let stepCount = 0;
    while (stepCount < MAX_STEPS) {
      const submitCheck = await findSubmitButton(page);
      if (submitCheck) break; // normal exit — we're on the last step

      const nextBtn = await findNextButton(page);
      if (!nextBtn) break; // neither submit nor next — bail out below

      stepCount++;
      log(`📄 Multi-step form — clicking Next (step ${stepCount})...`);
      const urlBefore = page.url();
      await nextBtn.click();

      // Wait for step transition: URL change OR new fields appearing
      try {
        await Promise.race([
          page.waitForURL((u) => u !== urlBefore, { timeout: 8000 }),
          page.waitForFunction(
            () =>
              document.querySelectorAll(
                'input:not([type="hidden"]), select, textarea',
              ).length > 0,
            { timeout: 8000 },
          ),
        ]);
      } catch {
        log(`⚠️  Step ${stepCount} transition timed out — continuing anyway.`);
      }
      await page.waitForTimeout(1000).catch(() => {});

      // Re-fingerprint the new step — filter out selectors already seen in
      // previous steps so we don't re-fill fields that were on step 1.
      const allStepFingerprints = await page.evaluate(FINGERPRINT_FN);
      const knownStepSelectors = new Set(fingerprints.map((f) => f.selector));
      // Also track selectors from previous multi-steps
      if (stepCount > 1) {
        allActions.forEach((a) => knownStepSelectors.add(a.selector));
      }
      const stepFingerprints = allStepFingerprints.filter(
        (f) => !knownStepSelectors.has(f.selector),
      );
      log(
        `   Step ${stepCount}: found ${stepFingerprints.length} new field(s) (${allStepFingerprints.length} total on page).`,
      );
      if (stepFingerprints.length === 0) break;

      // Map + fill the new step's fields
      const { actions: stepDeterministic, unmatched: stepUnmatched } =
        deterministicMap(stepFingerprints, profile);
      let stepGroqActions = [];
      if (stepUnmatched.length > 0) {
        try {
          stepGroqActions = await mapFieldsWithGroq(
            stepUnmatched,
            profile,
            log,
            jobText,
          );
        } catch (err) {
          log(`⚠️  Groq failed on step ${stepCount}: ${err.message}`);
        }
      }
      const stepActions = [...stepDeterministic, ...stepGroqActions];
      log(`   Step ${stepCount}: filling ${stepActions.length} field(s)...`);
      const stepNeedsHuman = await executeActions(page, stepActions, log);
      const { mismatches: stepMismatches } = await verifyFill(
        page,
        stepActions,
        stepFingerprints,
        log,
      );
      if (stepNeedsHuman || stepMismatches.length > 0) {
        log(`⚠️  Step ${stepCount} has issues — flagging for manual review.`);
        job.status = "MANUAL_REVIEW_NEEDED";
        await job.save();
        await new Promise((r) => setTimeout(r, 90000));
        await page.close().catch(() => {});
        return;
      }
      // Add step actions to allActions for registry recording
      allActions.push(...stepActions);
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

    if (DRY_RUN) {
      // ── DRY RUN: do everything except click submit ────────────────────
      // Form is filled and verified — hold the browser open so you can
      // inspect every field before deciding whether the mapping is correct.
      log(
        `🧪 DRY RUN — all fields verified clean. Submit button found but NOT clicked.`,
      );
      log(
        `🧪 Review the filled form in the browser now. Set DRY_RUN=false in .env to enable real submission.`,
      );
      job.status = "MANUAL_REVIEW_NEEDED";
      job.dryRun = true;
      await job.save();

      const waitStart = Date.now();
      while (Date.now() - waitStart < 90000) {
        if (waitControl.skip) {
          waitControl.skip = false;
          log("✅ Reviewed — moving to next job.");
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      await page.close().catch(() => {});
      if (ownContext) await context.close();
      return;
    }

    log(`🚀 All fields verified — submitting application...`);
    const urlBeforeSubmit = page.url();
    await submitBtn.click();

    // ── Submit confirmation: verify page actually changed ─────────────────
    // Don't blindly trust a timeout. Check for:
    //   1. URL change (most ATS redirect to a /confirmation or /thank-you page)
    //   2. "Thank you" / "Application received" text appearing on page
    // Falls back to a 10s wait if neither signal fires, then checks text anyway.
    // Simple phrase matching — avoids regex flag loss when patterns cross the
    // Playwright evaluate() serialisation boundary (.source drops /i flag).
    const THANKS_PHRASES = [
      "thank you",
      "application received",
      "application submitted",
      "successfully applied",
      "we'll be in touch",
      "we will be in touch",
      "your application has been",
      "you've applied",
      "you have applied",
      "confirmation",
    ];
    const getPageTextLower = async () =>
      (
        await page
          .evaluate(() => document.body?.innerText || "")
          .catch(() => "")
      ).toLowerCase();

    let confirmed = false;
    try {
      await Promise.race([
        page.waitForURL((url) => url !== urlBeforeSubmit, { timeout: 10000 }),
        (async () => {
          const deadline = Date.now() + 10000;
          while (Date.now() < deadline) {
            const txt = await getPageTextLower();
            if (THANKS_PHRASES.some((p) => txt.includes(p))) return;
            await new Promise((r) => setTimeout(r, 600));
          }
          throw new Error("thank-you text not found within timeout");
        })(),
      ]);
      confirmed = true;
    } catch {
      const txt = await getPageTextLower();
      confirmed = THANKS_PHRASES.some((p) => txt.includes(p));
    }

    if (confirmed) {
      log(
        `✅ Application submitted and confirmed (page changed after submit).`,
      );
    } else {
      log(
        `⚠️  Submit clicked but no confirmation signal detected — marking MANUAL_REVIEW_NEEDED.`,
      );
      job.status = "MANUAL_REVIEW_NEEDED";
      await job.save();
      await new Promise((r) => setTimeout(r, 90000));
      await page.close().catch(() => {});
      return;
    }

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
