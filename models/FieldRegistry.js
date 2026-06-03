import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────────────────
// models/FieldRegistry.js
//
// Stores selector→profile-field mappings that have been:
//   1. Verified 100% clean (zero mismatches, zero mismatch-after-retry)
//   2. Successfully submitted (submit button clicked, no errors)
//
// NEVER written to on partial fills, verify failures, or MANUAL_REVIEW leads.
//
// Future use: platformMap() Phase 0 will check this before falling through to
// deterministicMap/Groq — known selectors skip AI entirely.
// ─────────────────────────────────────────────────────────────────────────────

const fieldRegistrySchema = new mongoose.Schema(
  {
    platform: {
      type: String,
      required: true,
      enum: ["greenhouse", "lever", "unknown"],
    },

    // The CSS selector fingerprinted from the DOM (e.g. '#first_name', '[name="email"]')
    selector: { type: String, required: true },

    // Human-readable label scraped from the form (e.g. "First Name")
    label: { type: String, default: null },

    // Which profile key this selector maps to (e.g. 'email', 'firstName')
    // null when value is a static option (Yes/No, EEO choices, etc.)
    mapsTo: { type: String, default: null },

    // The Playwright action type ('fill' | 'select' | 'radio' | 'check' | 'autocomplete')
    action: { type: String, required: true },

    // Total times this selector appeared in ANY form fingerprint
    seenCount: { type: Number, default: 1 },

    // Times it was part of a 100%-clean verified + successfully submitted form
    // successCount / seenCount = reliability score
    successCount: { type: Number, default: 1 },

    // Audit trail
    lastSeen: { type: Date, default: null },
    lastJobUrl: { type: String, default: null },
  },
  { timestamps: true },
);

// Unique per (platform, selector) — upsert-safe
fieldRegistrySchema.index({ platform: 1, selector: 1 }, { unique: true });

// Convenience: high-confidence entries only (successCount >= 2)
fieldRegistrySchema.index({ platform: 1, successCount: -1 });

export const FieldRegistry = mongoose.model("FieldRegistry", fieldRegistrySchema);
