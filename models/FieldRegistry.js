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
    // Owner of this registry entry. Note: this data is structural only
    // (selector type + which profile KEY it maps to, never the actual value),
    // so sharing it across users would be technically safe — but it's kept
    // per-user for now to match a strict "nothing crosses between accounts"
    // policy. Can be revisited later if registry growth needs to be pooled.
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

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

// Unique per (userId, platform, selector) — upsert-safe, isolated per account
fieldRegistrySchema.index({ userId: 1, platform: 1, selector: 1 }, { unique: true });

// Convenience: high-confidence entries only (successCount >= 2)
fieldRegistrySchema.index({ userId: 1, platform: 1, successCount: -1 });

export const FieldRegistry = mongoose.model("FieldRegistry", fieldRegistrySchema);
