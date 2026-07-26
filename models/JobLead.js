import mongoose from "mongoose";

const jobLeadSchema = new mongoose.Schema(
  {
    // Owner of this lead — every query MUST filter by this.
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    jobTitle: { type: String, required: true },
    company: { type: String, default: "Unknown" },
    url: { type: String, required: true },
    location: { type: String, default: "Remote" },

    status: {
      type: String,
      enum: [
        "DISCOVERED",
        "ANALYZING_FORM",
        "APPLYING",
        "APPLIED",
        "CAPTCHA_BLOCKED",
        "FAILED",
        "FAILED_NEEDS_HEALING",
        "MANUAL_REVIEW_NEEDED",
        "ACCOUNT_SETUP_NEEDED", // Workday: waiting on you to sign in / create a tenant account
        "RESPONDED", // NEW: company replied to the application
      ],
      default: "DISCOVERED",
    },

    // NEW: Relevance scoring
    relevanceScore: { type: Number, default: null }, // 0-100
    skipReason: { type: String, default: null }, // why it was skipped

    // Submission + response tracking
    appliedAt: { type: Date, default: null }, // when agent successfully submitted
    respondedAt: { type: Date, default: null }, // when company replied
    responseType: {
      // what kind of reply
      type: String,
      enum: ["INTERVIEW", "REJECTION", "ASSESSMENT", "OTHER", null],
      default: null,
    },

    // Re-queue tracking — incremented each time a MANUAL_REVIEW_NEEDED job re-queues
    retryCount: { type: Number, default: 0 },

    // True once the agent has filled + verified the form and is waiting on
    // (or has finished waiting on) a human to actually click Submit.
    readyForHumanSubmit: { type: Boolean, default: false },
    // When the current 90s human-wait hold started (CAPTCHA, manual review,
    // account setup) — lets the dashboard show a live countdown instead of
    // a frozen status badge with no sense of time remaining.
    holdStartedAt: { type: Date, default: null },

    lastKnownHtml: { type: String, default: null },
    aiGeneratedSelector: { type: String, default: null },

    logs: [
      {
        timestamp: { type: Date, default: Date.now },
        message: String,
      },
    ],
  },
  { timestamps: true },
);

// A job URL must be unique PER USER — two different users tracking the same
// posting is fine; the same user tracking it twice is not.
jobLeadSchema.index({ url: 1, userId: 1 }, { unique: true });

export const JobLead = mongoose.model("JobLead", jobLeadSchema);
