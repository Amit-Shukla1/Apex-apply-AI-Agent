import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────────────────
// models/User.js
//
// Each user has their own login, their own profile (resume-derived data),
// and owns their own JobLeads + FieldRegistry entries via userId scoping.
// Passwords are NEVER stored in plaintext — only bcrypt hashes.
// ─────────────────────────────────────────────────────────────────────────────

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    // bcrypt hash — never the raw password
    passwordHash: { type: String, required: true },

    // Only true for accounts that should see the admin dashboard.
    // Set manually in the DB for now (no self-service admin signup).
    isAdmin: { type: Boolean, default: false },

    // Pro tier flag — toggled by an admin from the admin dashboard.
    // Gate any pro-only features (limits, AI usage, etc.) on this.
    isPro: { type: Boolean, default: false },
    proGrantedAt: { type: Date, default: null },

    // Profile is a loosely-typed blob — same shape the agent already expects
    // (name, email, phone, location, skills[], titles[], yearsOfExperience,
    // EEO fields, CTC fields, etc.) Kept flexible since the rest of the
    // codebase already treats profile as a free-form object.
    profile: { type: mongoose.Schema.Types.Mixed, default: {} },

    // Path to this user's uploaded resume PDF, e.g. "./uploads/<userId>/resume.pdf"
    resumePath: { type: String, default: null },
    resumeOriginalName: { type: String, default: null },
    resumeUploadedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const User = mongoose.model("User", userSchema);
