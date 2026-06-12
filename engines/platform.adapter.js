// ─────────────────────────────────────────────────────────────────────────────
// engines/platform.adapter.js
//
// Phase 0 — runs BEFORE deterministicMap() and Groq.
// Matches fields by HTML [name="..."] attribute directly from official ATS docs.
// This is near-100% reliable for Greenhouse + Lever core fields.
//
// Returns: { actions: [], skippedSelectors: Set }
//   actions          → ready to pass to executeActions()
//   skippedSelectors → selectors already handled; deterministicMap skips these
// ─────────────────────────────────────────────────────────────────────────────

import {
  GREENHOUSE_FIELDS,
  GREENHOUSE_EEO,
  LEVER_FIELDS,
  LEVER_EEO,
} from "../config/selectors.js";

// ── Detect platform from URL ──────────────────────────────────────────────────
export function detectPlatform(url = "") {
  if (url.includes("greenhouse.io")) return "greenhouse";
  if (url.includes("lever.co")) return "lever";
  return null;
}

// ── Build Greenhouse actions ──────────────────────────────────────────────────
function buildGreenhouseActions(fingerprints, profile, log) {
  const actions = [];
  const handled = new Set();

  // Map core fields — Greenhouse uses BOTH id="first_name" AND name="first_name"
  // bestSelector() in fingerprint prefers #id, so we try both.
  for (const [fieldName, resolver] of Object.entries(GREENHOUSE_FIELDS)) {
    const fp = fingerprints.find(
      (f) =>
        f.selector === `[name="${fieldName}"]` ||
        f.selector === `#${fieldName}`, // Greenhouse standard: id="first_name" etc.
    );
    if (!fp) continue;

    const result =
      typeof resolver === "function" ? resolver(profile) : resolver;
    if (!result) continue;

    const { value, action } =
      typeof result === "object" && "action" in result
        ? result
        : { value: result, action: fp.type === "select" ? "select" : "fill" };

    if (action === "skip" || action === "file") {
      handled.add(fp.selector);
      continue;
    }

    if (value === "" || value === null || value === undefined) continue;

    actions.push({ selector: fp.selector, action, value: String(value) });
    handled.add(fp.selector);
  }

  // Map EEO fields by label keyword (name attrs are dynamic IDs)
  // NOTE: fp.type is "select-one" (from el.type) not "select" — use startsWith
  for (const fp of fingerprints) {
    if (!fp.type.startsWith("select") || handled.has(fp.selector)) continue;
    const label = (fp.label || "").toLowerCase();

    for (const [key, resolver] of Object.entries(GREENHOUSE_EEO)) {
      const keyNorm = key.replace("_", " ");
      // Match by label text OR by selector ID (e.g. #gender, #veteran_status)
      const selectorId = (fp.selector || "").replace("#", "").toLowerCase();
      if (
        label.includes(keyNorm) ||
        label.includes(key) ||
        selectorId === key ||
        selectorId.includes(keyNorm)
      ) {
        const value = resolver(profile);
        if (value) {
          actions.push({ selector: fp.selector, action: "select", value });
          handled.add(fp.selector);
          break;
        }
      }
    }
  }

  // Map education[] fields
  for (const fp of fingerprints) {
    if (handled.has(fp.selector)) continue;
    const nameMatch = fp.selector.match(/\[name="education\[\d+\]\[(.+?)\]"\]/);
    if (!nameMatch) continue;
    const subField = nameMatch[1];
    const resolver = GREENHOUSE_EDUCATION?.[subField];
    if (!resolver) continue;
    const result = resolver(profile);
    const { value, action } =
      typeof result === "object" && "action" in result
        ? result
        : { value: result, action: fp.type === "select" ? "select" : "fill" };
    if (action === "skip" || !value) {
      handled.add(fp.selector);
      continue;
    }
    actions.push({ selector: fp.selector, action, value: String(value) });
    handled.add(fp.selector);
  }

  log(
    `🎯 [Greenhouse adapter] ${actions.length} fields mapped by name/id attr. ${handled.size - actions.length} skipped (file/hidden).`,
  );
  return { actions, handled };
}

// ── Build Lever actions ───────────────────────────────────────────────────────
function buildLeverActions(fingerprints, profile, log) {
  const actions = [];
  const handled = new Set();

  // Map core fields by [name="..."]
  for (const [fieldName, resolver] of Object.entries(LEVER_FIELDS)) {
    // Lever uses both exact name and sometimes prefixed like "name" → input[name="name"]
    const fp = fingerprints.find((f) => f.selector === `[name="${fieldName}"]`);
    if (!fp) continue;

    const result =
      typeof resolver === "function" ? resolver(profile) : resolver;
    if (!result && result !== "") continue;

    const { value, action } =
      typeof result === "object" && "action" in result
        ? result
        : { value: result, action: fp.type === "select" ? "select" : "fill" };

    if (action === "skip" || action === "file") {
      handled.add(fp.selector);
      continue;
    }

    if (value === "" || value === null || value === undefined) continue;

    actions.push({ selector: fp.selector, action, value: String(value) });
    handled.add(fp.selector);
  }

  // Map EEO radio/select fields — Lever uses eeo[gender] etc.
  for (const [fieldName, resolver] of Object.entries(LEVER_EEO)) {
    const fp = fingerprints.find((f) => f.selector === `[name="${fieldName}"]`);
    if (!fp) continue;
    const value = resolver(profile);
    if (!value) continue;
    const action = fp.type === "radio" ? "radio" : "select";
    actions.push({ selector: fp.selector, action, value });
    handled.add(fp.selector);
  }

  // NOTE: Lever custom card fields (cards[UUID][fieldN]) are intentionally
  // NOT handled here — they go through deterministicMap then Groq.

  log(
    `🎯 [Lever adapter] ${actions.length} fields mapped by name attr. ${handled.size - actions.length} skipped (file/EEO/custom).`,
  );
  return { actions, handled };
}

// ── Main export ───────────────────────────────────────────────────────────────
export function platformMap(platform, fingerprints, profile, log) {
  if (platform === "greenhouse") {
    return buildGreenhouseActions(fingerprints, profile, log);
  }
  if (platform === "lever") {
    return buildLeverActions(fingerprints, profile, log);
  }
  // Unknown platform — return empty, fall through to deterministicMap + Groq
  return { actions: [], handled: new Set() };
}
