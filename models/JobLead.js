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

    // NEW: Response tracking
    respondedAt: { type: Date, default: null }, // when company replied
    responseType: {
      // what kind of reply
      type: String,
      enum: ["INTERVIEW", "REJECTION", "ASSESSMENT", "OTHER", null],
      default: null,
    },

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
