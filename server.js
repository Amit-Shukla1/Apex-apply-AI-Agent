import express from "express";
import cors from "cors";
import multer from "multer";
import pdfParse from "pdf-parse";
import dotenv from "dotenv";
import { createServer } from "http";
import { Server } from "socket.io";
import mongoose from "mongoose";
import { runDiscoveryAgent } from "./engines/discovery.agent.js";
import { runApplicationAgent } from "./engines/application.agent.js";
import { JobLead } from "./models/JobLead.js";
import { FieldRegistry } from "./models/FieldRegistry.js";
import { launchBrowser } from "./services/browser.manager.js";
import fs from "fs";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

mongoose
  .connect(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/apex", {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.log("❌ DB Error:", err));

const upload = multer({ storage: multer.memoryStorage() });
let activeAgent = false;

app.post("/api/upload-resume", upload.single("resume"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const pdfData = await pdfParse(req.file.buffer);
    const text = pdfData.text;

    const geminiPayload = {
      contents: [
        {
          parts: [
            {
              text: `You are an expert ATS resume parser. Extract the candidate's details from the following resume text. 
                    Most importantly, analyze their skills and experience, and generate a list of the TOP 5 most relevant job titles they should apply for based on their actual stack.
                    
                    Return ONLY a raw JSON object with this exact structure (no markdown, no backticks):
                    {
                        "name": "Full Name",
                        "email": "email@example.com",
                        "phone": "Phone Number",
                        "location": "City, Country",
                        "titles": ["Target Role 1", "Target Role 2", "Target Role 3", "Target Role 4", "Target Role 5"]
                    }
                    
                    Resume Text:
                    ${text}`,
            },
          ],
        },
      ],
    };

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=undefined`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(geminiPayload),
      },
    );

    const llmData = await response.json();

    if (!llmData.candidates) {
      return res.status(500).json({ error: "Gemini API Quota/Error" });
    }

    const rawJsonString = llmData.candidates[0].content.parts[0].text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();
    const profile = JSON.parse(rawJsonString);

    profile.resumePath = "./uploads/resume.pdf";

    fs.mkdirSync("./uploads", { recursive: true });
    fs.writeFileSync("./uploads/resume.pdf", req.file.buffer);

    res.json({ profile });
  } catch (error) {
    console.error("Parse Error:", error);
    res.status(500).json({ error: "Failed to parse resume" });
  }
});

app.post("/api/start", async (req, res) => {
  const { explicitEmail, profile, platform } = req.body;
  activeAgent = true;
  res.json({ message: "Agent started" });

  (async () => {
    try {
      await runDiscoveryAgent(profile, profile.location, io, platform);
      if (!activeAgent) return;

      const leads = await JobLead.find({ status: "DISCOVERED" });
      // Shared context: one browser session for all jobs so CAPTCHA tokens persist
      const browserCtx = await launchBrowser("application");
      for (const lead of leads) {
        if (!activeAgent) break;
        await runApplicationAgent(lead, profile, io, browserCtx);
      }
      await browserCtx.close();
      io.emit("log", { message: "✅ All tasks completed." });
    } catch (e) {
      io.emit("log", { message: `❌ Engine Error: ${e.message}` });
    }
    activeAgent = false;
  })();
});

app.post("/api/stop", (req, res) => {
  activeAgent = false;
  res.json({ message: "Agent stopped" });
});

// ─── LEADS ───────────────────────────────────────────────────────────────────
app.get("/api/leads", async (req, res) => {
  try {
    const leads = await JobLead.find().sort({ createdAt: -1 });
    res.json(leads);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch leads" });
  }
});

app.delete("/api/leads/clear/all", async (req, res) => {
  try {
    await JobLead.deleteMany({});
    res.json({ message: "All leads cleared" });
  } catch (err) {
    res.status(500).json({ error: "Failed to clear leads" });
  }
});

app.post("/api/leads/:id/retry", async (req, res) => {
  try {
    await JobLead.findByIdAndUpdate(req.params.id, {
      status: "DISCOVERED",
      skipReason: null,
    });
    res.json({ message: "Lead reset to DISCOVERED" });
  } catch (err) {
    res.status(500).json({ error: "Failed to retry lead" });
  }
});

app.delete("/api/leads/:id", async (req, res) => {
  try {
    await JobLead.findByIdAndDelete(req.params.id);
    res.json({ message: "Lead deleted" });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete lead" });
  }
});

app.get("/api/status", (req, res) => {
  res.json({ running: activeAgent });
});

// ─── FIELD REGISTRY ──────────────────────────────────────────────────────────

// GET /api/registry — summary stats + all known selectors
app.get("/api/registry", async (req, res) => {
  try {
    const { platform } = req.query; // optional filter: ?platform=greenhouse
    const query = platform ? { platform } : {};
    const entries = await FieldRegistry.find(query)
      .sort({ successCount: -1, seenCount: -1 })
      .lean();

    const stats = {
      total: entries.length,
      byPlatform: entries.reduce((acc, e) => {
        acc[e.platform] = (acc[e.platform] || 0) + 1;
        return acc;
      }, {}),
      highConfidence: entries.filter((e) => e.successCount >= 2).length,
    };

    res.json({ stats, entries });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch registry" });
  }
});

// DELETE /api/registry — wipe registry (useful during dev/testing)
app.delete("/api/registry", async (req, res) => {
  try {
    const result = await FieldRegistry.deleteMany({});
    res.json({ message: `Cleared ${result.deletedCount} registry entries.` });
  } catch (err) {
    res.status(500).json({ error: "Failed to clear registry" });
  }
});

// ─── OUTCOME LOOP ─────────────────────────────────────────────────────────────

// POST /api/leads/:id/responded — mark a lead as responded (interview/rejection/etc.)
// Call this manually or from a future email-scraper when a company replies.
app.post("/api/leads/:id/responded", async (req, res) => {
  try {
    const { responseType } = req.body; // 'INTERVIEW' | 'REJECTION' | 'ASSESSMENT' | 'OTHER'
    const valid = ["INTERVIEW", "REJECTION", "ASSESSMENT", "OTHER"];
    if (responseType && !valid.includes(responseType)) {
      return res.status(400).json({ error: `responseType must be one of: ${valid.join(", ")}` });
    }
    const lead = await JobLead.findByIdAndUpdate(
      req.params.id,
      {
        status: "RESPONDED",
        respondedAt: new Date(),
        responseType: responseType || "OTHER",
      },
      { new: true },
    );
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    res.json({ message: "Lead marked as responded", lead });
  } catch (err) {
    res.status(500).json({ error: "Failed to update lead" });
  }
});

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () =>
  console.log(`✅ APEX Server running on port ${PORT}`),
);
