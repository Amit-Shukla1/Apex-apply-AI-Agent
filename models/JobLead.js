import mongoose from "mongoose";

const jobLeadSchema = new mongoose.Schema(
  {
    jobTitle: { type: String, required: true },
    company: { type: String, default: "Unknown" },
    url: { type: String, required: true, unique: true },
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

    // True if this job was processed while DRY_RUN=true (form filled but not submitted)
    dryRun: { type: Boolean, default: false },

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

export const JobLead = mongoose.model("JobLead", jobLeadSchema);
