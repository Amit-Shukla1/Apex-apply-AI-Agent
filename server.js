import express from "express";
import cors from "cors";
import multer from "multer";
import pdfParse from "pdf-parse";
import dotenv from "dotenv";
import session from "express-session";
import MongoStore from "connect-mongo";
import bcrypt from "bcryptjs";
import { createServer } from "http";
import { Server } from "socket.io";
import mongoose from "mongoose";
import { runDiscoveryAgent } from "./engines/discovery.agent.js";
import { runApplicationAgent } from "./engines/application.agent.js";
import { JobLead } from "./models/JobLead.js";
import { FieldRegistry } from "./models/FieldRegistry.js";
import { User } from "./models/User.js";
import { requireAuth, requireAdmin } from "./middleware/auth.js";
import { launchBrowser } from "./services/browser.manager.js";
import fs from "fs";
import { waitControl } from "./services/wait.control.js";

dotenv.config();

const app = express();

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:3000";
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/apex";
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json());

// ── Sessions persisted to MongoDB ──────────────────────────────────────────
// Previously the default in-memory store, which loses every logged-in
// session the instant nodemon restarts the server — which happens
// constantly during development. That looked like random logouts/socket
// failures with no obvious cause. Sessions now survive restarts.
//
// IMPORTANT: sessionStore must be declared BEFORE session({...}) references
// it — a previous edit referenced it out of order, which would throw
// "sessionStore is not defined" at startup (or silently no-op the store).
const sessionStore = MongoStore.create({
  mongoUrl: MONGO_URI,
  collectionName: "sessions",
  touchAfter: 24 * 3600, // only rewrite session on touch once/day, not every request — cuts the "unable to find session to touch" race way down
});
sessionStore.on("error", (err) => {
  console.error("⚠️  Session store error (non-fatal):", err.message);
});

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || "apex-dev-secret-change-me",
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 1000 * 60 * 60 * 8,
  },
});
app.use(sessionMiddleware);

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: CLIENT_ORIGIN, credentials: true },
});

io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

mongoose
  .connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.log("❌ DB Error:", err));

const upload = multer({ storage: multer.memoryStorage() });

const activeAgents = new Map();

io.on("connection", (socket) => {
  const userId = socket.request.session?.userId;
  if (!userId) {
    // Diagnostic — tells us WHICH of the three failure modes this actually is:
    //   1. No cookie header at all reached the handshake
    //   2. A session was found but has no userId on it
    //   3. No session object at all (store lookup found nothing)
    console.log("🔌 Socket auth failed — diagnostic:");
    console.log("   Cookie header present:", !!socket.request.headers.cookie);
    console.log("   Session object exists:", !!socket.request.session);
    console.log("   Session content:", socket.request.session);
    socket.disconnect(true);
    return;
  }
  socket.join(`user_${userId}`);

  socket.on("skip_wait", () => {
    waitControl.skip = true;
  });
});

app.post("/api/register", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }
    if (password.length < 8) {
      return res
        .status(400)
        .json({ error: "Password must be at least 8 characters" });
    }
    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return res
        .status(409)
        .json({ error: "An account with this email already exists" });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({
      email: email.toLowerCase().trim(),
      passwordHash,
    });

    req.session.userId = user._id.toString();
    req.session.isAdmin = !!user.isAdmin;
    // Explicitly wait for the Mongo write to finish before responding —
    // otherwise the browser can get its cookie back (and Socket.IO can try
    // to use it) before the session actually exists in the store, which is
    // what caused "Unable to find the session to touch".
    req.session.save((err) => {
      if (err) {
        console.error("Session save error (register):", err);
        return res
          .status(500)
          .json({ error: "Registration failed — try again" });
      }
      res.json({
        message: "Account created",
        user: {
          id: user._id,
          email: user.email,
          isAdmin: user.isAdmin,
          isPro: !!user.isPro,
          profile: user.profile,
        },
      });
    });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "Failed to register" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    req.session.userId = user._id.toString();
    req.session.isAdmin = !!user.isAdmin;
    // Same reasoning as register above — wait for the write to land before
    // the client gets its cookie back.
    req.session.save((err) => {
      if (err) {
        console.error("Session save error (login):", err);
        return res.status(500).json({ error: "Login failed — try again" });
      }
      res.json({
        message: "Logged in",
        user: {
          id: user._id,
          email: user.email,
          isAdmin: user.isAdmin,
          isPro: !!user.isPro,
          profile: user.profile,
        },
      });
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Failed to log in" });
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ message: "Logged out" });
  });
});

app.get("/api/me", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("-passwordHash");
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({
      user: {
        id: user._id,
        email: user.email,
        isAdmin: user.isAdmin,
        isPro: !!user.isPro,
        profile: user.profile,
        resumeOriginalName: user.resumeOriginalName,
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

app.post(
  "/api/upload-resume",
  requireAuth,
  upload.single("resume"),
  async (req, res) => {
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
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(geminiPayload),
        },
      );

      const llmData = await response.json();

      if (!llmData.candidates) {
        // Log the actual error from Gemini instead of guessing — could be a
        // bad/missing API key, a retired model name, a quota limit, or a
        // malformed request. The response body says which.
        console.error("Gemini API error:", JSON.stringify(llmData));
        const reason =
          llmData?.error?.message || "Unknown error — check server logs";
        return res
          .status(500)
          .json({ error: `Resume parsing failed: ${reason}` });
      }

      const rawJsonString = llmData.candidates[0].content.parts[0].text
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();
      const parsed = JSON.parse(rawJsonString);

      const user = await User.findById(req.userId);
      const mergedProfile = { ...user.profile, ...parsed };

      const resumeDir = `./uploads/${req.userId}`;
      fs.mkdirSync(resumeDir, { recursive: true });
      const resumePath = `${resumeDir}/resume.pdf`;
      fs.writeFileSync(resumePath, req.file.buffer);

      mergedProfile.resumePath = resumePath;
      user.profile = mergedProfile;
      user.resumePath = resumePath;
      user.resumeOriginalName = req.file.originalname;
      user.resumeUploadedAt = new Date();
      await user.save();

      res.json({ profile: mergedProfile });
    } catch (error) {
      console.error("Parse Error:", error);
      res.status(500).json({ error: "Failed to parse resume" });
    }
  },
);

app.delete("/api/resume", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    if (user.resumePath && fs.existsSync(user.resumePath)) {
      fs.unlinkSync(user.resumePath);
    }

    user.resumePath = null;
    user.resumeOriginalName = null;
    user.resumeUploadedAt = null;
    if (user.profile) {
      delete user.profile.resumePath;
    }
    await user.save();

    res.json({ message: "Resume removed", profile: user.profile });
  } catch (err) {
    console.error("Resume delete error:", err);
    res.status(500).json({ error: "Failed to remove resume" });
  }
});

app.patch("/api/profile", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: "User not found" });
    user.profile = { ...user.profile, ...req.body };
    await user.save();
    res.json({ profile: user.profile });
  } catch (err) {
    res.status(500).json({ error: "Failed to update profile" });
  }
});

app.post("/api/start", requireAuth, async (req, res) => {
  const { platform } = req.body;
  const userId = req.userId;
  activeAgents.set(userId, true);
  res.json({ message: "Agent started" });

  const roomIo = io.to(`user_${userId}`);

  (async () => {
    try {
      const user = await User.findById(userId);
      const profile = user.profile || {};

      await runDiscoveryAgent(
        profile,
        profile.location,
        roomIo,
        platform,
        userId,
      );
      if (!activeAgents.get(userId)) return;

      const leads = await JobLead.find({ status: "DISCOVERED", userId });
      const browserCtx = await launchBrowser("application");
      for (const lead of leads) {
        if (!activeAgents.get(userId)) break;
        await runApplicationAgent(lead, profile, roomIo, browserCtx);
      }
      await browserCtx.close();
      roomIo.emit("log", { message: "✅ All tasks completed." });
    } catch (e) {
      roomIo.emit("log", { message: `❌ Engine Error: ${e.message}` });
    }
    activeAgents.set(userId, false);
  })();
});

app.post("/api/stop", requireAuth, (req, res) => {
  activeAgents.set(req.userId, false);
  res.json({ message: "Agent stopped" });
});

app.get("/api/status", requireAuth, (req, res) => {
  res.json({ running: !!activeAgents.get(req.userId) });
});

app.get("/api/leads", requireAuth, async (req, res) => {
  try {
    const leads = await JobLead.find({ userId: req.userId }).sort({
      createdAt: -1,
    });
    res.json(leads);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch leads" });
  }
});

app.delete("/api/leads/clear/all", requireAuth, async (req, res) => {
  try {
    await JobLead.deleteMany({ userId: req.userId });
    res.json({ message: "All leads cleared" });
  } catch (err) {
    res.status(500).json({ error: "Failed to clear leads" });
  }
});

app.post("/api/leads/:id/retry", requireAuth, async (req, res) => {
  try {
    const result = await JobLead.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { status: "DISCOVERED", skipReason: null },
    );
    if (!result) return res.status(404).json({ error: "Lead not found" });
    res.json({ message: "Lead reset to DISCOVERED" });
  } catch (err) {
    res.status(500).json({ error: "Failed to retry lead" });
  }
});

app.post("/api/leads/retry/all", requireAuth, async (req, res) => {
  try {
    const { statuses } = req.body;
    const filter = {
      userId: req.userId,
      status: statuses?.length
        ? { $in: statuses }
        : {
            $in: [
              "FAILED",
              "FAILED_NEEDS_HEALING",
              "MANUAL_REVIEW_NEEDED",
              "CAPTCHA_BLOCKED",
              "ACCOUNT_SETUP_NEEDED",
            ],
          },
    };
    const result = await JobLead.updateMany(filter, {
      $set: { status: "DISCOVERED", skipReason: null, retryCount: 0 },
    });
    res.json({ message: `Reset ${result.modifiedCount} leads to DISCOVERED` });
  } catch (err) {
    res.status(500).json({ error: "Failed to retry all leads" });
  }
});

app.delete("/api/leads/:id", requireAuth, async (req, res) => {
  try {
    const result = await JobLead.findOneAndDelete({
      _id: req.params.id,
      userId: req.userId,
    });
    if (!result) return res.status(404).json({ error: "Lead not found" });
    res.json({ message: "Lead deleted" });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete lead" });
  }
});

app.get("/api/registry", requireAuth, async (req, res) => {
  try {
    const { platform } = req.query;
    const query = { userId: req.userId, ...(platform && { platform }) };
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

app.delete("/api/registry", requireAuth, async (req, res) => {
  try {
    const result = await FieldRegistry.deleteMany({ userId: req.userId });
    res.json({ message: `Cleared ${result.deletedCount} registry entries.` });
  } catch (err) {
    res.status(500).json({ error: "Failed to clear registry" });
  }
});

app.post("/api/leads/:id/responded", requireAuth, async (req, res) => {
  try {
    const { responseType } = req.body;
    const valid = ["INTERVIEW", "REJECTION", "ASSESSMENT", "OTHER"];
    if (responseType && !valid.includes(responseType)) {
      return res
        .status(400)
        .json({ error: `responseType must be one of: ${valid.join(", ")}` });
    }
    const lead = await JobLead.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
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

app.patch("/api/admin/users/:id/pro", requireAdmin, async (req, res) => {
  try {
    const { isPro } = req.body;
    if (typeof isPro !== "boolean") {
      return res.status(400).json({ error: "isPro must be true or false" });
    }
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isPro, proGrantedAt: isPro ? new Date() : null },
      { new: true },
    ).select("-passwordHash");
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({
      message: `${user.email} is now ${isPro ? "Pro" : "Free"}`,
      user: {
        id: user._id,
        email: user.email,
        isAdmin: user.isAdmin,
        isPro: !!user.isPro,
      },
    });
  } catch (err) {
    console.error("Admin pro-toggle error:", err);
    res.status(500).json({ error: "Failed to update pro status" });
  }
});

app.get("/api/admin/overview", requireAdmin, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalLeads = await JobLead.countDocuments();
    const totalApplied = await JobLead.countDocuments({ status: "APPLIED" });
    const totalManualReview = await JobLead.countDocuments({
      status: "MANUAL_REVIEW_NEEDED",
    });
    const totalFailed = await JobLead.countDocuments({
      status: { $in: ["FAILED", "FAILED_NEEDS_HEALING", "CAPTCHA_BLOCKED"] },
    });
    const totalRegistryEntries = await FieldRegistry.countDocuments();
    const applyRate =
      totalLeads > 0 ? Math.round((totalApplied / totalLeads) * 100) : 0;

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const newUsersThisWeek = await User.countDocuments({
      createdAt: { $gte: sevenDaysAgo },
    });

    const statusBreakdown = await JobLead.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    const platformBreakdown = await JobLead.aggregate([
      {
        $project: {
          platform: {
            $cond: [
              { $regexMatch: { input: "$url", regex: /greenhouse/i } },
              "Greenhouse",
              {
                $cond: [
                  { $regexMatch: { input: "$url", regex: /lever/i } },
                  "Lever",
                  "Other",
                ],
              },
            ],
          },
        },
      },
      { $group: { _id: "$platform", count: { $sum: 1 } } },
    ]);

    res.json({
      totalUsers,
      newUsersThisWeek,
      totalLeads,
      totalApplied,
      totalManualReview,
      totalFailed,
      totalRegistryEntries,
      applyRate,
      statusBreakdown: statusBreakdown.map((s) => ({
        status: s._id,
        count: s.count,
      })),
      platformBreakdown: platformBreakdown.map((p) => ({
        platform: p._id,
        count: p.count,
      })),
    });
  } catch (err) {
    console.error("Admin overview error:", err);
    res.status(500).json({ error: "Failed to fetch admin overview" });
  }
});

app.get("/api/admin/users", requireAdmin, async (req, res) => {
  try {
    const users = await User.find().select("-passwordHash").lean();

    const userStats = await Promise.all(
      users.map(async (u) => {
        const [leadCount, appliedCount, manualCount, failedCount] =
          await Promise.all([
            JobLead.countDocuments({ userId: u._id }),
            JobLead.countDocuments({ userId: u._id, status: "APPLIED" }),
            JobLead.countDocuments({
              userId: u._id,
              status: "MANUAL_REVIEW_NEEDED",
            }),
            JobLead.countDocuments({
              userId: u._id,
              status: {
                $in: ["FAILED", "FAILED_NEEDS_HEALING", "CAPTCHA_BLOCKED"],
              },
            }),
          ]);
        return {
          id: u._id,
          email: u.email,
          isAdmin: !!u.isAdmin,
          isPro: !!u.isPro,
          createdAt: u.createdAt,
          hasResume: !!u.resumePath,
          profileName: u.profile?.name || null,
          leadCount,
          appliedCount,
          manualCount,
          failedCount,
          applyRate:
            leadCount > 0 ? Math.round((appliedCount / leadCount) * 100) : 0,
        };
      }),
    );

    userStats.sort((a, b) => b.leadCount - a.leadCount);
    res.json({ users: userStats });
  } catch (err) {
    console.error("Admin users error:", err);
    res.status(500).json({ error: "Failed to fetch user breakdown" });
  }
});

app.get("/api/admin/timeseries", requireAdmin, async (req, res) => {
  try {
    const days = 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const signupsRaw = await User.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const applicationsRaw = await JobLead.aggregate([
      { $match: { status: "APPLIED", appliedAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$appliedAt" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const dayMap = (raw) => {
      const m = new Map(raw.map((r) => [r._id, r.count]));
      const out = [];
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
        const key = d.toISOString().slice(0, 10);
        out.push({ date: key, count: m.get(key) || 0 });
      }
      return out;
    };

    res.json({
      signups: dayMap(signupsRaw),
      applications: dayMap(applicationsRaw),
    });
  } catch (err) {
    console.error("Admin timeseries error:", err);
    res.status(500).json({ error: "Failed to fetch timeseries" });
  }
});

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () =>
  console.log(`✅ APEX Server running on port ${PORT}`),
);
