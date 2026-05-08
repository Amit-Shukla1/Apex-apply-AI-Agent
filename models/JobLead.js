import mongoose from "mongoose";

const jobLeadSchema = new mongoose.Schema(
  {
    jobTitle: { type: String, required: true },
    company: { type: String, default: "Unknown" },
    url: { type: String, required: true, unique: true }, // Prevent duplicate applications
    location: { type: String, default: "Remote" },

    // THE STATE MACHINE: This dictates what the orchestrator tells the bot to do next
    status: {
      type: String,
      enum: [
        "DISCOVERED",
        "ANALYZING_FORM",
        "APPLYING",
        "CAPTCHA_BLOCKED",
        "FAILED",
        "APPLIED",
      ],
      default: "DISCOVERED",
    },

    // Persistent Memory for Self-Healing
    lastKnownHtml: { type: String, default: null }, // Stores broken form HTML for the AI to fix
    aiGeneratedSelector: { type: String, default: null }, // Stores the CSS selector the AI writes

    // Audit Trail
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
