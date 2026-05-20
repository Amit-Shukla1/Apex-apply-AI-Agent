// ─────────────────────────────────────────────────────────────────────────────
// config/selectors.js
// Complete field maps for Greenhouse & Lever — matched by HTML name attribute.
// These are sourced from official API docs (boards-api.greenhouse.io,
// lever/postings-api on GitHub) so they are stable across all companies.
//
// HOW IT WORKS:
//   platformMap() in application.agent.js runs BEFORE deterministicMap().
//   It queries the DOM by [name="..."] directly — no label guessing needed.
//   Only custom question_XXXX / card fields go to Groq.
// ─────────────────────────────────────────────────────────────────────────────

// ── GREENHOUSE ────────────────────────────────────────────────────────────────
// Source: https://developers.greenhouse.io/job-board.html
//         https://github.com/grnhse/greenhouse-api-docs
//
// Structure: { fieldName: (profile) => value | { value, action } }
//   action defaults to "fill". Use "select" for <select>, "file" for uploads,
//   "autocomplete" for Google-Places-style location inputs.

export const GREENHOUSE_FIELDS = {
  // ── Core identity ───────────────────────────────────────────────────────────
  first_name: (p) => p.firstName || (p.name || "").split(" ")[0] || "",
  last_name: (p) =>
    p.lastName || (p.name || "").split(" ").slice(1).join(" ") || "",
  email: (p) => p.email || "",
  phone: (p) => p.phone || "",

  // ── Resume / cover letter ───────────────────────────────────────────────────
  // These are file inputs — handled separately by attachResume().
  // Included here so platformMap can skip them (avoids sending to Groq).
  resume: () => ({ action: "file" }),
  resume_text: (p) => ({ value: p.summary || "", action: "fill" }),
  cover_letter: () => ({ action: "file" }),
  cover_letter_text: (p) => ({ value: p.summary || "", action: "fill" }),

  // ── Location (Greenhouse uses Google Places autocomplete) ───────────────────
  location: (p) => ({
    value: p.city || (p.location || "").split(",")[0].trim() || "",
    action: "autocomplete",
  }),
  // latitude / longitude / country_short_name are hidden — browser fills them
  // via the Places API widget. We skip them.
  latitude: () => ({ action: "skip" }),
  longitude: () => ({ action: "skip" }),
  country_short_name: () => ({ action: "skip" }),

  // ── LinkedIn / websites (Greenhouse "link" custom fields) ──────────────────
  // These appear as input_text questions but always use these name patterns:
  "job_application[answers_attributes][][text_value]": () => ({
    action: "skip",
  }), // handled per-question
};

// Greenhouse EEO / demographic selectors — these use select dropdowns.
// Names are standard across all Greenhouse boards that enable EEO.
export const GREENHOUSE_EEO = {
  // The actual name attrs look like: job_application[demographic_answers_attributes][N][answer_option_ids][]
  // We detect these by label keywords instead (deterministicMap already handles them).
  // Listed here for documentation purposes.
  gender: (p) => p.gender || "Decline to self-identify",
  race: (p) => p.ethnicity || "Decline to self-identify",
  veteran_status: (p) => p.veteran || "I am not a protected veteran",
  disability_status: (p) => p.disability || "I don't wish to answer",
};

// Greenhouse education field names (inside education[] arrays)
export const GREENHOUSE_EDUCATION = {
  // These appear as select dropdowns populated from Greenhouse's school/degree APIs.
  // We match them by [name^="education"] in platformMap.
  school_name_id: (p) => p.educationSchool || "",
  degree_id: (p) => p.educationDegree || "Bachelor's Degree",
  discipline_id: (p) => p.educationField || "Computer Science",
  // start_date and end_date are nested objects — skip, too complex for automation
  start_date: () => ({ action: "skip" }),
  end_date: () => ({ action: "skip" }),
};

// ── LEVER ─────────────────────────────────────────────────────────────────────
// Source: https://github.com/lever/postings-api (README — Apply to a job posting)
//         https://help.lever.co/hc/en-us/articles/20087243347741
//
// Lever forms are hosted at jobs.lever.co/{company}/{uuid}/apply
// Field names are consistent across ALL Lever-powered companies.

export const LEVER_FIELDS = {
  // ── Always present (required by Lever system) ───────────────────────────────
  name: (p) =>
    p.name || `${p.firstName || ""} ${p.lastName || ""}`.trim() || "",
  email: (p) => p.email || "",

  // ── Optional personal info (recruiter can make mandatory) ──────────────────
  phone: (p) => p.phone || "",
  org: (p) => p.currentCompany || "", // "Current Company"
  comments: (p) => p.summary || "", // cover letter / additional info

  // ── Location — Lever uses an autocomplete (hCaptcha-protected for bots) ─────
  // The field renders as: input[name="location"] with autocomplete dropdown.
  location: (p) => ({
    value: p.city || (p.location || "").split(",")[0].trim() || "",
    action: "autocomplete",
  }),

  // ── Resume — file input ─────────────────────────────────────────────────────
  resume: () => ({ action: "file" }),

  // ── URL / link fields — Lever uses urls[LinkedIn], urls[GitHub] etc. ────────
  // These render as: input[name="urls[LinkedIn]"]
  "urls[LinkedIn]": (p) => p.linkedinUrl || "",
  "urls[GitHub]": (p) => p.githubUrl || "",
  "urls[Twitter]": (p) => p.twitterUrl || "",
  "urls[Portfolio]": (p) => p.portfolioUrl || "",
  "urls[Other]": (p) => p.portfolioUrl || "", // fallback

  // ── Preferred pronouns (optional, added by recruiter) ──────────────────────
  pronouns: () => "", // leave blank — no profile field for this
};

// Lever EEO fields — these appear as radio groups or selects under "eeo" section.
// Names follow: eeo[gender], eeo[race], eeo[veteran], eeo[disability]
export const LEVER_EEO = {
  "eeo[gender]": (p) => p.gender || "I prefer not to answer",
  "eeo[race]": (p) => p.ethnicity || "I prefer not to answer",
  "eeo[veteran]": (p) => p.veteran || "I prefer not to answer",
  "eeo[disability]": (p) => p.disability || "I prefer not to answer",
};

// ── LINKEDIN ──────────────────────────────────────────────────────────────────
// (Existing selectors kept — Easy Apply modal fields)
export const LINKEDIN_SELECTORS = {
  jobCard: ".job-card-container",
  easyApplyButton: "button.jobs-apply-button",
  nextButton: 'button[aria-label="Continue to next step"]',
  submitButton: 'button[aria-label="Submit application"]',
  formInput: 'input[type="text"]',
  resumeUpload: 'input[type="file"]',
};

// ── SUBMIT BUTTON CANDIDATES ──────────────────────────────────────────────────
// Used by findSubmitButton() in application.agent.js
export const SUBMIT_SELECTORS = {
  greenhouse: [
    '[data-testid="submit-app-btn"]',
    "#submit_app",
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Submit Application")',
    'button:has-text("Submit")',
  ],
  lever: [
    '.postings-btn[type="submit"]',
    'button[type="submit"]',
    'button:has-text("Submit application")',
    'button:has-text("Apply")',
    ".template-btn-submit",
  ],
};
