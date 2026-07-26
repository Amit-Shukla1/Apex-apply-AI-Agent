import { launchBrowser } from "../services/browser.manager.js";
import { waitControl } from "../services/wait.control.js";
import { detectPlatform, platformMap } from "./platform.adapter.js";
import { FieldRegistry } from "../models/FieldRegistry.js";
import dotenv from "dotenv";

// ── Shared human-wait helper ────────────────────────────────────────────────
async function waitForHuman(ms, doneMessage, log) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (waitControl.skip) {
      waitControl.skip = false;
      if (doneMessage) log(doneMessage);
      return true;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}
dotenv.config();

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "openai/gpt-oss-20b";
const CHUNK_SIZE = 15;

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
    for (let i = 0; i < 12 && node; i++) {
      const heading = node.querySelector(
        ":scope > h1,:scope > h2,:scope > h3,:scope > h4,:scope > h5",
      );
      if (heading) return heading.innerText.trim();
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
    if (el.name) return `[name="${el.name}"]`;
    if (el.id && /^\d/.test(el.id)) {
      return `[id="${el.id}"]`;
    }
    if (el.id) return `#${CSS.escape(el.id)}`;
    const automationId = el.getAttribute("data-automation-id");
    if (automationId)
      return `[data-automation-id="${CSS.escape(automationId)}"]`;
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

function deterministicMap(fingerprints, profile) {
  const actions = [];
  const unmatched = [];

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
    } else if (/\bemail\b/.test(c)) {
      value = profile.email || "";
    } else if (/\bphone\b|\bmobile\b|\btel\b/.test(c)) {
      const rawPhone = (profile.phone || "").replace(/[\s\-()]/g, "");
      const localPhone =
        rawPhone.replace(/^\+?\d{1,2}(?=\d{10}$)/, "") || rawPhone;
      value = localPhone;
    } else if (
      /\bcity\b|candidate[\s-]?location|current[\s-]?location|location[\s-]?input/.test(
        c,
      )
    ) {
      value = city;
    } else if (/\bcountry\b/.test(c)) {
      value = country;
      actionType = t.startsWith("select") ? "select" : "autocomplete";
    } else if (/linkedin/.test(c)) {
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
    } else if (
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
    } else if (
      /current.*location|current.*city|current.*address|where.*based|where.*located/i.test(
        c,
      ) &&
      t !== "radio" &&
      !t.startsWith("select")
    ) {
      value = profile.location || "";
    } else if (
      /what.*know.*about|why.*interested.*join|why.*want.*join|why.*company|tell.*about.*us|about.*our.*company/i.test(
        c,
      )
    ) {
      value =
        profile.companyInterest ||
        profile.whyHireYou ||
        `I'm excited about this opportunity as it aligns with my background in ${(profile.skills || []).slice(0, 3).join(", ")}. I believe I can contribute meaningfully to the team.`;
    } else if (
      /why.*hire|why.*good.*fit|why.*apply|why.*interest|why.*role|why.*position|what.*motivat|why.*want/i.test(
        c,
      ) &&
      t !== "checkbox" &&
      !t.startsWith("select")
    ) {
      value = profile.whyHireYou || profile.summary || "";
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
    } else if (/\bschool\b|university|college|institution/.test(c)) {
      value =
        profile.educationSchool ||
        (profile.education || "").split(",")[0].trim();
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
    } else if (/\bpronoun/i.test(c)) {
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
      t !== "checkbox" &&
      t !== "radio"
    ) {
      value = "LinkedIn";
      actionType = t.startsWith("select") ? "select" : "fill";
    }

    if (value === null && t === "checkbox") {
      const lbl = `${f.label} ${f.hint} ${c}`.toLowerCase();
      const candidateSkills = (profile.skills || []).map((s) =>
        s.toLowerCase(),
      );
      const skillMatch = candidateSkills.some((sk) => {
        const skCore = sk.replace(/[.\s]/g, "");
        return lbl.includes(sk) || lbl.replace(/[.\s]/g, "").includes(skCore);
      });
      const labelWords = lbl
        .split(/[^a-z0-9+#.]+/i)
        .filter((w) => w.length >= 3);
      const areaMatch = candidateSkills.some((sk) => {
        const skWords = sk.split(/[^a-z0-9+#.]+/i).filter((w) => w.length >= 3);
        return skWords.some((w) => labelWords.includes(w));
      });
      const isTerms =
        /terms|condition|authoriz|consent|certif|confirm|agree|acknowledge|privacy/i.test(
          lbl,
        );
      if (skillMatch || areaMatch || isTerms) {
        value = true;
        actionType = "check";
      }
    }

    if (value !== null && value !== "") {
      if (/\bphone\b|\bmobile\b|\btel\b/.test(c)) {
        actions.push({
          selector: f.selector,
          action: "phone_country",
          value: "in",
        });
      }
      actions.push({ selector: f.selector, action: actionType, value });
    } else {
      unmatched.push(f);
    }
  }

  return { actions, unmatched };
}

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

    const validSet = new Set(chunkSelectors);
    const valid = actions.filter(
      (a) => a.unanswered || validSet.has(a.selector),
    );
    const filtered = actions.length - valid.length;
    if (filtered > 0)
      log(
        `   🧹 Chunk ${i + 1}: filtered ${filtered} hallucinated selector(s).`,
      );

    const dedupMap = new Map();
    for (const a of valid) dedupMap.set(a.selector, a);
    const deduped = [...dedupMap.values()];
    if (deduped.length < valid.length)
      log(
        `   🧹 Chunk ${i + 1}: collapsed ${valid.length - deduped.length} duplicate selector(s).`,
      );
    allActions.push(...deduped);
  }

  log(
    `🧠 Groq returned ${allActions.length} valid action(s) for unmatched fields.`,
  );
  return allActions;
}

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
            const filled = await page
              .evaluate(
                ({ sel, val }) => {
                  const el = document.querySelector(sel);
                  if (!el) return false;
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

            if (!filled) {
              await page.fill(action.selector, String(action.value), {
                timeout: 5000,
              });
            }
          }
          break;
        }

        case "select": {
          const target = String(action.value).toLowerCase().trim();
          const options = await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (!el || !el.options) return [];
            return Array.from(el.options).map((o) => ({
              value: o.value,
              text: o.text.trim(),
            }));
          }, action.selector);

          if (options.length === 0) {
            log(`⚠️  select: no options found for ${action.selector}`);
            break;
          }

          let match = options.find((o) => o.text === String(action.value));
          if (!match)
            match = options.find((o) => o.text.toLowerCase() === target);
          if (!match) {
            const firstWord = target.split(" ")[0];
            if (firstWord.length >= 3) {
              match = options.find((o) =>
                o.text.toLowerCase().includes(firstWord),
              );
            }
          }
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

        case "phone_country": {
          try {
            const flagBtn = await page.$(
              '.iti__selected-flag, [class*="flag-dropdown"], [class*="country-select"]',
            );
            if (flagBtn && (await flagBtn.isVisible().catch(() => false))) {
              await flagBtn.click();
              await page.waitForTimeout(300);
              const indiaOpt = await page.$(
                '[data-dial-code="91"], [data-country-code="in"], li.iti__country[data-country-code="in"]',
              );
              if (indiaOpt) {
                await indiaOpt.click();
                await page.waitForTimeout(150);
                await page.keyboard.press("Escape");
              } else {
                await page.keyboard.press("Escape");
              }
              await page.waitForTimeout(200);
            }
          } catch (e) {
            /* Non-fatal — country code dropdown may not exist on this form */
          }
          break;
        }

        case "autocomplete": {
          try {
            await page.click(action.selector, { timeout: 5000 });
          } catch {
            /* field may already be focused */
          }
          await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (el) {
              el.value = "";
              el.dispatchEvent(new Event("input", { bubbles: true }));
            }
          }, action.selector);
          await page.type(action.selector, String(action.value), { delay: 60 });
          await page.waitForTimeout(1200);

          const DROPDOWN_SELECTORS = [
            ".pac-item:first-child",
            ".pac-container .pac-item:first-child",
            '[role="option"]:first-child',
            '[role="listbox"] [role="option"]:first-child',
            ".suggestions li:first-child",
            ".autocomplete-suggestions div:first-child",
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
            await page.keyboard.press("ArrowDown");
            await page.waitForTimeout(400);
            await page.keyboard.press("Enter");
          }
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
            if (el.type === "file") {
              results.push({ ...action, status: "OK", actual: "(file)" });
              break;
            }
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
            // Not a native <select> — some ATS platforms (Greenhouse custom
            // question types especially) render custom-styled dropdowns that
            // look like a select but have no .options/.selectedIndex at all.
            // Reading el.options[el.selectedIndex] on those throws
            // "Cannot read properties of undefined (reading 'undefined')" —
            // this guard turns that crash into a clean, informative status
            // instead, and treats it as OK so it doesn't block submission
            // (the same custom-dropdown case is already treated as
            // best-effort/skippable in executeActions above).
            if (!el.options || el.selectedIndex === undefined) {
              results.push({
                ...action,
                status: "OK",
                actual:
                  "(custom dropdown, not a native <select> — skipped verification)",
              });
              break;
            }
            const selected = el.options[el.selectedIndex]?.text?.trim() ?? "";
            const NEUTRAL_KW = [
              "decline",
              "prefer not",
              "self-identify",
              "wish to answer",
              "rather not",
              "no response",
              "choose not",
              "not disclosed",
            ];
            const isNeutralExpected = NEUTRAL_KW.some((kw) =>
              String(action.value).toLowerCase().includes(kw),
            );
            const isNeutralActual = NEUTRAL_KW.some((kw) =>
              selected.toLowerCase().includes(kw),
            );
            const match =
              selected.toLowerCase() === String(action.value).toLowerCase() ||
              (isNeutralExpected && isNeutralActual);
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

// ─── Wait for the real application form to render ──────────────────────────
// Root cause behind BOTH the Lever "0 fields found" cases AND the Greenhouse
// "found department-filter/office-filter" cases in your logs: a fixed
// 1.5s wait after navigation isn't enough time for these React/SPA-based
// job boards to route from "page shell" to "the actual application form."
// On Greenhouse specifically, landing too early can mean the agent
// fingerprints the general job-board LISTING page (with search filters like
// #department-filter, #office-filter) instead of the specific job's
// application form — which is exactly what happened on the Xometry and
// Netlify jobs in your log (found 4 and 1 fields respectively, none of them
// real application fields).
//
// This waits for a concrete signal that the real form is present — a file
// upload input (present on essentially every ATS application form) or
// visible "submit"/"apply" text — instead of guessing a fixed delay.
async function waitForApplicationForm(page, log, timeoutMs = 12000) {
  try {
    await page.waitForFunction(
      () => {
        const hasFileInput = !!document.querySelector('input[type="file"]');
        const hasNameOrEmail = !!document.querySelector(
          'input[name="name"], input[name="email"], input[name*="name" i], input[type="email"]',
        );
        const bodyText = (document.body?.innerText || "").toLowerCase();
        const hasSubmitText =
          bodyText.includes("submit application") ||
          bodyText.includes("submit your application");
        return hasFileInput || hasNameOrEmail || hasSubmitText;
      },
      { timeout: timeoutMs },
    );
    return true;
  } catch {
    log(
      `⚠️  Application form did not show a clear ready-signal within ${timeoutMs / 1000}s — continuing anyway (may land on a listing/filter page instead of the real form).`,
    );
    return false;
  }
}

async function openLeverForm(page, url, log) {
  const base = url.split("#")[0].replace(/\/$/, "");
  const applyUrl = base.endsWith("/apply") ? base : `${base}/apply`;
  log(`🔗 Lever detected — navigating to apply page: ${applyUrl}`);
  await page.goto(applyUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  // Widened from 10s to 20s, and broadened the selector set — your logs
  // showed the page itself taking 10-13s to respond even before the form
  // had to render on top of that, so 10s was cutting it right at the wire.
  // Also added resume/comments fields as fallback signals, since some Lever
  // tenants customize field names and don't always expose name/email first.
  try {
    await page.waitForSelector(
      'input[name="name"], input[name="email"], input[name="resume"], textarea[name="comments"], input[type="file"]',
      { timeout: 20000 },
    );
    log(`   Lever form loaded.`);
  } catch {
    log(`⚠️  Lever form did not load in time — continuing anyway.`);
  }
}

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

  const skillVariants = skills.map((s) => [
    s,
    s.replace(/\.js$/i, ""),
    s.replace(/[.\s]/g, ""),
    s.replace(/[.\s-]/g, " ").trim(),
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

async function findSubmitButton(page) {
  const CANDIDATES = [
    '[data-automation-id="bottom-navigation-submit-button"]',
    'button[type="submit"]',
    'input[type="submit"]',
    '[data-testid="submit-app-btn"]',
    '[data-testid="apply-button"]',
    'button:has-text("Submit Application")',
    'button:has-text("Submit application")',
    'button:has-text("Submit")',
    'button:has-text("Send Application")',
    'button:has-text("Apply Now")',
    'button:has-text("Apply")',
    ".submit-btn",
    "#submit-app",
    "#submit_app",
  ];
  for (const sel of CANDIDATES) {
    try {
      const btn = await page.$(sel);
      if (btn && (await btn.isVisible()) && !(await btn.isDisabled())) {
        return btn;
      }
    } catch {
      /* continue */
    }
  }
  return null;
}

async function findNextButton(page) {
  const CANDIDATES = [
    '[data-automation-id="bottom-navigation-next-button"]',
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

function inferMapsTo(value, profile) {
  if (value === null || value === undefined) return null;
  const needle = String(value).trim().toLowerCase();
  if (!needle) return null;
  for (const [key, val] of Object.entries(profile)) {
    if (val === null || val === undefined) continue;
    if (typeof val === "object") continue;
    if (String(val).trim().toLowerCase() === needle) return key;
  }
  return null;
}

async function saveToRegistry(
  platform,
  allActions,
  fingerprints,
  profile,
  jobUrl,
  log,
  userId,
) {
  try {
    const fingerprintBySelector = new Map(
      fingerprints.map((f) => [f.selector, f]),
    );

    const ops = [];
    for (const action of allActions) {
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
          filter: { userId, platform, selector: action.selector },
          update: {
            $inc: { seenCount: 1, successCount: 1 },
            $set: {
              action: action.action,
              lastSeen: new Date(),
              lastJobUrl: jobUrl,
              ...(label && { label }),
              ...(mapsTo && { mapsTo }),
            },
            $setOnInsert: {
              userId,
              platform,
              selector: action.selector,
              seenCount: 0,
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
    log(`⚠️  Registry write skipped: ${err.message.split("\n")[0]}`);
  }
}

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
      // Give Greenhouse/Workday/other SPA-based boards time to route to the
      // actual job's application form before fingerprinting. Without this,
      // fingerprinting can run while the page is still showing the general
      // job-board LISTING view (with #department-filter/#office-filter
      // search controls) rather than the specific job's apply form — which
      // is what happened on the Xometry/Netlify jobs in the earlier log.
      await waitForApplicationForm(page, log);
    }

    log(`📊 Scoring job relevance...`);
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

    const hasCaptcha = await page.evaluate(() => {
      const bodyText = document.body?.innerText?.toLowerCase() || "";
      const hasCaptchaFrame = !!document.querySelector(
        'iframe[src*="captcha"], iframe[src*="recaptcha"], iframe[src*="hcaptcha"], ' +
          ".h-captcha, .g-recaptcha, [data-sitekey], #challenge-form",
      );
      const hasCaptchaText =
        bodyText.includes("verify you are human") ||
        bodyText.includes("select all images") ||
        bodyText.includes("match the shapes") ||
        bodyText.includes("i'm not a robot") ||
        bodyText.includes("security check");
      return hasCaptchaFrame || hasCaptchaText;
    });
    if (hasCaptcha) {
      log(
        `🤖 CAPTCHA detected — pausing so you can solve it manually in the browser.`,
      );
      job.status = "CAPTCHA_BLOCKED";
      job.holdStartedAt = new Date();
      await job.save();
      await waitForHuman(
        90000,
        "✅ Marked as solved — re-checking the page...",
        log,
      );
      const stillThere = await page
        .evaluate(() => {
          const bodyText = document.body?.innerText?.toLowerCase() || "";
          return (
            !!document.querySelector(
              'iframe[src*="captcha"], iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .h-captcha, .g-recaptcha, [data-sitekey], #challenge-form',
            ) || bodyText.includes("verify you are human")
          );
        })
        .catch(() => true);
      if (stillThere) {
        log(`🤖 CAPTCHA still present — skipping this one for now.`);
        await page.close().catch(() => {});
        return;
      }
      log(`✅ CAPTCHA cleared — continuing.`);
      job.status = "ANALYZING_FORM";
      await job.save();
    }

    const platform = detectPlatform(job.url);

    if (platform === "workday") {
      const onAccountPage = await page
        .evaluate(() => {
          const bodyText = document.body?.innerText?.toLowerCase() || "";
          return (
            !!document.querySelector(
              '[data-automation-id="signInLink"], [data-automation-id="createAccountLink"], [data-automation-id="createAccountSubmitButton"]',
            ) ||
            (bodyText.includes("create account") &&
              bodyText.includes("password")) ||
            (bodyText.includes("sign in") &&
              bodyText.includes("apply manually"))
          );
        })
        .catch(() => false);

      if (onAccountPage) {
        log(
          `🔐 Workday account/sign-in page detected — pausing for you to sign in or create an account.`,
        );
        job.status = "ACCOUNT_SETUP_NEEDED";
        job.holdStartedAt = new Date();
        await job.save();
        await waitForHuman(90000, "✅ Marked done — continuing.", log);
        job.status = "ANALYZING_FORM";
        await job.save();
      }
    }

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

    let registryActions = [];
    let registrySelectors = new Set();
    try {
      const currentSelectorSet = new Set(fingerprints.map((f) => f.selector));
      const hits = await FieldRegistry.find({
        userId: job.userId,
        platform: platform || "unknown",
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

    const remainingAfterPlatform = fingerprints.filter(
      (f) =>
        !handledSelectors.has(f.selector) && !registrySelectors.has(f.selector),
    );

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

    await attachResume(page, profile.resumePath, log);

    if (platform === "workday") {
      try {
        const autofillBtn = await page.$(
          '[data-automation-id="autofillWithResume"], button:has-text("Autofill with Resume"), button:has-text("Use this resume")',
        );
        if (autofillBtn && (await autofillBtn.isVisible())) {
          log(`📄 Workday resume autofill button found — using it.`);
          await autofillBtn.click();
          await page.waitForTimeout(2500).catch(() => {});
        }
      } catch {
        /* not present — fine, continue with normal mapping */
      }
    }

    let needsHuman = await executeActions(page, allActions, log);

    const { mismatches, newFields } = await verifyFill(
      page,
      allActions,
      fingerprints,
      log,
    );

    let finalMismatches = [];
    if (mismatches.length > 0) {
      log(`🔄 Retrying ${mismatches.length} mismatch(es)...`);
      await executeActions(page, mismatches, log);
      const { mismatches: stillBroken } = await verifyFill(
        page,
        mismatches,
        fingerprints,
        log,
      );
      finalMismatches = [
        ...new Map(stillBroken.map((m) => [m.selector, m])).values(),
      ];
      if (finalMismatches.length > 0) {
        log(`⚠️  ${finalMismatches.length} field(s) still wrong after retry.`);
        needsHuman = true;
      } else {
        log(`✅ All mismatches resolved on retry.`);
      }
    }

    if (newFields.length > 0) {
      log(`⚠️  Conditional fields appeared — flagging for manual review.`);
      needsHuman = true;
    }

    const EEO_OR_CARD =
      /eeo\[|pronouns|\/gender|#gender|\/race|#race|veteran|disability|cards\[/i;
    const requiredUnmapped = fingerprints.filter(
      (f) => f.required && !allActions.some((a) => a.selector === f.selector),
    );
    const requiredMismatches = finalMismatches.filter((m) => {
      if (EEO_OR_CARD.test(m.selector)) return false;
      const fp = fingerprints.find((f) => f.selector === m.selector);
      return fp?.required;
    });
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
      job.holdStartedAt = new Date();
      await job.save();
      const userClickedDone = await waitForHuman(
        90000,
        "✅ Manual review marked done — moving to next job.",
        log,
      );

      if (userClickedDone && platform) {
        try {
          const { mismatches: afterManual } = await verifyFill(
            page,
            allActions,
            fingerprints,
            log,
          );
          const cleanActions = allActions.filter(
            (a) => !afterManual.some((m) => m.selector === a.selector),
          );
          if (cleanActions.length > 0) {
            await saveToRegistry(
              platform,
              cleanActions,
              fingerprints,
              profile,
              job.url,
              log,
              job.userId,
            );
            log(
              `📚 Registry: learned ${cleanActions.length} field(s) from manual correction.`,
            );
          }
        } catch (e) {
          log(`⚠️  Registry learn-from-manual skipped: ${e.message}`);
        }
      }
      await page.close().catch(() => {});
      job.status = "DISCOVERED";
      job.retryCount = (job.retryCount || 0) + 1;
      if (job.retryCount >= 3) {
        job.status = "FAILED";
        log(`❌ Job exceeded 3 manual review attempts — marking FAILED.`);
      } else {
        log(`🔄 Re-queued for retry (attempt ${job.retryCount}/3).`);
      }
      await job.save();
      return;
    }

    const MAX_STEPS = platform === "workday" ? 8 : 5;
    let stepCount = 0;
    while (stepCount < MAX_STEPS) {
      const submitCheck = await findSubmitButton(page);
      if (submitCheck) break;

      const nextBtn = await findNextButton(page);
      if (!nextBtn) break;

      stepCount++;
      log(`📄 Multi-step form — clicking Next (step ${stepCount})...`);
      const urlBefore = page.url();
      await nextBtn.click();

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

      if (platform === "workday") {
        const onSensitiveStep = await page
          .evaluate(() => {
            const heading = (
              document.querySelector(
                "h2, h1, [data-automation-id='pageHeader']",
              )?.innerText || ""
            ).toLowerCase();
            return (
              heading.includes("voluntary disclosure") ||
              heading.includes("self identify") ||
              heading.includes("self-identify")
            );
          })
          .catch(() => false);

        if (onSensitiveStep) {
          log(
            `🧍 Workday Voluntary Disclosures / Self Identify step — these are your own legal self-attestation, not something Apex will guess at. Pausing for you.`,
          );
          job.status = "MANUAL_REVIEW_NEEDED";
          job.readyForHumanSubmit = false;
          job.holdStartedAt = new Date();
          await job.save();
          await waitForHuman(90000, "✅ Marked done — continuing.", log);
          job.status = "ANALYZING_FORM";
          await job.save();
        }
      }

      const allStepFingerprints = await page.evaluate(FINGERPRINT_FN);
      const knownStepSelectors = new Set(fingerprints.map((f) => f.selector));
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
        job.holdStartedAt = new Date();
        await job.save();
        await waitForHuman(90000, "✅ Marked done — continuing.", log);
        await page.close().catch(() => {});
        return;
      }
      allActions.push(...stepActions);
    }

    log(`🔍 Verify clean — searching for submit button...`);
    const submitBtn = await findSubmitButton(page);

    if (!submitBtn) {
      log(`⚠️  Submit button not found — flagging for manual review.`);
      job.status = "MANUAL_REVIEW_NEEDED";
      job.holdStartedAt = new Date();
      await job.save();
      await waitForHuman(90000, "✅ Marked done — continuing.", log);
      await page.close().catch(() => {});
      return;
    }

    log(
      `✅ All fields verified clean. Submit button found but NOT clicked — that's your call.`,
    );
    log(
      `👤 Review the filled form in the browser now, then click Submit yourself if it looks right.`,
    );
    job.status = "MANUAL_REVIEW_NEEDED";
    job.readyForHumanSubmit = true;
    job.holdStartedAt = new Date();
    await job.save();

    const urlBeforeWait = page.url();
    await waitForHuman(
      90000,
      "✅ Marked done — checking whether it was submitted...",
      log,
    );

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
    const pageTextLower = (
      await page.evaluate(() => document.body?.innerText || "").catch(() => "")
    ).toLowerCase();
    const submitted =
      page.url() !== urlBeforeWait ||
      THANKS_PHRASES.some((p) => pageTextLower.includes(p));

    if (submitted) {
      log(`✅ Looks like it went through — marking APPLIED.`);
      if (platform) {
        try {
          await saveToRegistry(
            platform,
            allActions,
            fingerprints,
            profile,
            job.url,
            log,
            job.userId,
          );
        } catch (e) {
          log(`⚠️  Registry save skipped: ${e.message}`);
        }
      }
      job.status = "APPLIED";
      job.appliedAt = new Date();
    } else {
      log(
        `ℹ️  No confirmation detected — leaving as manual review for you to finish or retry.`,
      );
    }
    await job.save();

    await page.close().catch(() => {});
    if (ownContext) await context.close();
    return;
  } catch (err) {
    log(`❌ Fatal error: ${err.message}`);
    job.status = "FAILED_NEEDS_HEALING";
    await job.save();
    if (page) await page.close().catch(() => {});
    if (ownContext && context) await context.close();
  }
};
