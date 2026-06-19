import { useState, useEffect, useRef, useCallback } from "react";
import { io } from "socket.io-client";

const SERVER = "http://localhost:5000";
const socket = io(SERVER);

const fmt = (n) => (n || 0).toString().padStart(2, "0");
const timeAgo = (date) => {
  if (!date) return "—";
  const s = Math.floor((Date.now() - new Date(date)) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

const STATUS_META = {
  DISCOVERED: {
    label: "Discovered",
    color: "#3b82f6",
    bg: "rgba(59,130,246,0.12)",
  },
  ANALYZING_FORM: {
    label: "Analyzing",
    color: "#a78bfa",
    bg: "rgba(167,139,250,0.12)",
  },
  APPLYING: {
    label: "Applying",
    color: "#f59e0b",
    bg: "rgba(245,158,11,0.12)",
  },
  APPLIED: {
    label: "Applied ✓",
    color: "#10b981",
    bg: "rgba(16,185,129,0.12)",
  },
  MANUAL_REVIEW_NEEDED: {
    label: "Manual review",
    color: "#f97316",
    bg: "rgba(249,115,22,0.12)",
  },
  FAILED_NEEDS_HEALING: {
    label: "Needs healing",
    color: "#ec4899",
    bg: "rgba(236,72,153,0.12)",
  },
  CAPTCHA_BLOCKED: {
    label: "Captcha",
    color: "#ef4444",
    bg: "rgba(239,68,68,0.12)",
  },
  FAILED: { label: "Failed", color: "#6b7280", bg: "rgba(107,114,128,0.12)" },
};

const STEPS = [
  "Score",
  "Fingerprint",
  "Map fields",
  "Fill",
  "Verify",
  "Submit",
];

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@300;400;500&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #08090b; --panel: #0d0f14; --panel2: #111318;
    --border: #1c1f2a; --border2: #252836;
    --gold: #e8b84b; --gold2: #f5d27a;
    --green: #00e57a; --red: #ff4560; --blue: #3b82f6;
    --text: #e8eaf0; --muted: #4a5068; --muted2: #6b7280;
    --font: 'Syne', sans-serif; --mono: 'JetBrains Mono', monospace;
  }
  html, body, #root { height: 100%; background: var(--bg); color: var(--text); font-family: var(--font); }
  ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }

  /* ── Layout ── */
  .app { display: grid; grid-template-rows: 52px 1fr; height: 100vh; overflow: hidden; }
  .body { display: grid; grid-template-columns: 310px 1fr; overflow: hidden; }
  .main { display: flex; flex-direction: column; overflow: hidden; }

  /* ── Topbar ── */
  .topbar { display: flex; align-items: center; justify-content: space-between; padding: 0 20px; border-bottom: 1px solid var(--border); background: var(--panel); position: relative; z-index: 10; }
  .topbar::after { content:''; position:absolute; bottom:0; left:0; right:0; height:1px; background: linear-gradient(90deg,transparent,var(--gold),transparent); }
  .logo { font-size: 15px; font-weight: 800; letter-spacing: .12em; }
  .logo span { color: var(--gold); }
  .status-pill { display: flex; align-items: center; gap: 6px; background: var(--panel2); border: 1px solid var(--border2); border-radius: 20px; padding: 4px 12px; font-family: var(--mono); font-size: 11px; color: var(--muted2); }
  .status-pill.on { border-color: rgba(0,229,122,.3); color: var(--green); }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); }
  .dot.on { background: var(--green); animation: pulse 2s infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
  .topbar-right { display: flex; gap: 8px; }
  .tbtn { background: var(--panel2); border: 1px solid var(--border2); color: var(--muted2); border-radius: 6px; padding: 5px 12px; font-family: var(--mono); font-size: 11px; cursor: pointer; transition: all .15s; }
  .tbtn:hover { color: var(--text); border-color: var(--muted); }
  .tbtn.danger:hover { border-color: var(--red); color: var(--red); }
  .tbtn.go { border-color: rgba(232,184,75,.4); color: var(--gold); }
  .tbtn.go:hover { background: rgba(232,184,75,.08); }
  .tbtn.stop { border-color: rgba(255,69,96,.4); color: var(--red); }
  .tbtn.stop:hover { background: rgba(255,69,96,.08); }

  /* ── Sidebar ── */
  .sidebar { background: var(--panel); border-right: 1px solid var(--border); display: flex; flex-direction: column; overflow-y: auto; overflow-x: hidden; gap: 0; }
  .sb-section { border-bottom: 1px solid var(--border); padding: 14px; }
  .sb-label { font-family: var(--mono); font-size: 9px; letter-spacing: .14em; color: var(--muted); text-transform: uppercase; margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between; }
  .sb-label-action { color: var(--muted2); cursor: pointer; font-size: 10px; }
  .sb-label-action:hover { color: var(--gold); }

  /* Live agent */
  .live-company { font-size: 14px; font-weight: 700; color: var(--text); margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .live-role { font-family: var(--mono); font-size: 10px; color: var(--muted2); margin-bottom: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .step-row { display: flex; align-items: center; gap: 7px; margin-bottom: 5px; font-family: var(--mono); font-size: 10px; }
  .step-ic { width: 16px; height: 16px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 8px; flex-shrink: 0; }
  .step-ic.done { background: #14532d; color: var(--green); }
  .step-ic.active { background: #78350f; color: var(--gold); animation: pulse 1s infinite; }
  .step-ic.wait { background: #1a1a1a; color: #374151; }
  .step-label.done { color: var(--muted); }
  .step-label.active { color: var(--gold); }
  .step-label.wait { color: #374151; }
  .rel-wrap { margin-top: 10px; }
  .rel-top { display: flex; justify-content: space-between; font-family: var(--mono); font-size: 9px; color: var(--muted); margin-bottom: 4px; }
  .rel-bar { background: var(--border2); border-radius: 3px; height: 3px; overflow: hidden; }
  .rel-fill { height: 100%; border-radius: 3px; background: linear-gradient(90deg, #f59e0b, #00e57a); transition: width .5s; }
  .idle-state { font-family: var(--mono); font-size: 11px; color: var(--muted); text-align: center; padding: 12px 0; }

  /* Queue */
  .q-item { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--border); }
  .q-item:last-child { border-bottom: none; }
  .q-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--border2); border: 1px solid var(--muted); flex-shrink: 0; }
  .q-company { font-size: 11px; color: var(--muted2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .q-role { font-family: var(--mono); font-size: 9px; color: var(--muted); }

  /* Profile */
  .profile-row { display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 12px; }
  .pk { font-family: var(--mono); font-size: 10px; color: var(--muted); }
  .pv { color: var(--muted2); text-align: right; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .field { display: flex; flex-direction: column; gap: 3px; margin-bottom: 8px; }
  .field label { font-family: var(--mono); font-size: 9px; letter-spacing: .1em; color: var(--muted); text-transform: uppercase; }
  .field input { background: var(--panel2); border: 1px solid var(--border2); border-radius: 5px; padding: 7px 9px; font-family: var(--mono); font-size: 11px; color: var(--text); outline: none; transition: border-color .2s; }
  .field input:focus { border-color: var(--gold); }
  .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .role-tag { display: inline-block; margin: 2px; background: rgba(232,184,75,.1); border: 1px solid rgba(232,184,75,.2); color: var(--gold2); font-family: var(--mono); font-size: 9px; padding: 2px 7px; border-radius: 3px; }

  /* Upload */
  .upload-zone { border: 1px dashed var(--border2); border-radius: 8px; padding: 14px; text-align: center; cursor: pointer; background: var(--panel2); position: relative; transition: all .2s; }
  .upload-zone:hover { border-color: var(--gold); background: rgba(232,184,75,.04); }
  .upload-zone input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; }
  .upload-zone.loaded { border-color: var(--green); background: rgba(0,229,122,.04); }
  .upload-text { font-family: var(--mono); font-size: 11px; color: var(--muted2); margin-top: 4px; }
  .upload-zone.loaded .upload-text { color: var(--green); }

  /* Deploy */
  .deploy-btn { display: flex; align-items: center; justify-content: space-between; padding: 9px 12px; border-radius: 6px; border: 1px solid var(--border2); background: var(--panel2); cursor: pointer; font-family: var(--font); font-size: 12px; font-weight: 600; color: var(--text); width: 100%; margin-bottom: 6px; transition: all .15s; }
  .deploy-btn:hover:not(:disabled) { border-color: var(--gold); background: rgba(232,184,75,.06); }
  .deploy-btn:disabled { opacity: .4; cursor: not-allowed; }
  .deploy-btn .arrow { color: var(--muted); }
  .btn-stop { width: 100%; padding: 9px 12px; border-radius: 6px; border: 1px solid rgba(255,69,96,.3); background: rgba(255,69,96,.08); color: var(--red); cursor: pointer; font-family: var(--font); font-size: 12px; font-weight: 700; transition: all .15s; }
  .btn-stop:hover { background: rgba(255,69,96,.15); }

  /* Stats */
  .stats-strip { display: flex; flex-wrap: wrap; background: var(--panel); border-bottom: 1px solid var(--border); flex-shrink: 0; align-items: flex-end; padding: 10px 14px; gap: 0; }
  .stat { padding: 4px 14px 4px 0; min-width: 80px; }
  .stats-strip-label { display: flex; align-items: center; gap: 8px; width: 100%; margin-bottom: 6px; }
  .stat-val { font-size: 22px; font-weight: 800; line-height: 1; }
  .stat-lbl { font-family: var(--mono); font-size: 9px; color: var(--muted); text-transform: uppercase; letter-spacing: .1em; margin-top: 3px; }

  /* Filters */
  .filters { display: flex; align-items: center; gap: 5px; padding: 10px 14px; border-bottom: 1px solid var(--border); flex-shrink: 0; overflow-x: auto; }
  .fbtn { padding: 4px 10px; border-radius: 4px; border: 1px solid var(--border2); background: transparent; color: var(--muted2); font-family: var(--mono); font-size: 10px; cursor: pointer; white-space: nowrap; transition: all .15s; }
  .fbtn.active { background: var(--gold); border-color: var(--gold); color: #000; font-weight: 700; }
  .fbtn:not(.active):hover { border-color: var(--muted); color: var(--text); }
  .filters-right { margin-left: auto; display: flex; gap: 6px; }

  /* Cards */
  .pipeline { flex: 1; overflow-y: auto; padding: 12px 14px; }
  .job-card { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; margin-bottom: 8px; display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: start; transition: border-color .15s; }
  .job-card:hover { border-color: var(--border2); }
  .jc-company { font-size: 13px; font-weight: 700; color: var(--text); margin-bottom: 1px; }
  .jc-role { font-family: var(--mono); font-size: 10px; color: var(--muted2); margin-bottom: 8px; }
  .jc-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 3px; font-family: var(--mono); font-size: 9px; letter-spacing: .03em; font-weight: 500; }
  .score-wrap { display: flex; align-items: center; gap: 5px; font-family: var(--mono); font-size: 10px; color: var(--muted); }
  .score-bar { width: 36px; height: 3px; background: var(--border2); border-radius: 2px; overflow: hidden; }
  .score-fill { height: 100%; border-radius: 2px; }
  .score-fill.hi { background: var(--green); }
  .score-fill.md { background: var(--gold); }
  .score-fill.lo { background: var(--red); }
  .skip-reason { font-family: var(--mono); font-size: 9px; color: var(--muted); }
  .jc-time { font-family: var(--mono); font-size: 9px; color: #374151; }
  .jc-actions { display: flex; flex-direction: column; gap: 5px; align-items: flex-end; }
  .ic-btn { background: var(--panel2); border: 1px solid var(--border2); border-radius: 4px; padding: 4px 10px; font-family: var(--mono); font-size: 10px; color: var(--muted2); cursor: pointer; transition: all .15s; white-space: nowrap; }
  .ic-btn:hover { color: var(--text); border-color: var(--muted); }
  .ic-btn.del:hover { color: var(--red); border-color: rgba(255,69,96,.4); }
  .ic-btn.retry:hover { color: var(--gold); border-color: rgba(232,184,75,.4); }
  .empty { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 200px; color: var(--muted); font-family: var(--mono); font-size: 12px; gap: 8px; }

  /* Log panel */
  .logpanel { border-top: 1px solid var(--border); background: #060709; flex-shrink: 0; transition: height .2s; }
  .logpanel.open { height: 140px; }
  .logpanel.closed { height: 34px; }
  .log-header { display: flex; align-items: center; gap: 8px; padding: 6px 14px; border-bottom: 1px solid var(--border); cursor: pointer; height: 34px; }
  .log-dots { display: flex; gap: 4px; }
  .ld { width: 8px; height: 8px; border-radius: 50%; }
  .log-title { font-family: var(--mono); font-size: 10px; color: var(--muted); letter-spacing: .08em; margin-right: auto; }
  .log-toggle { font-family: var(--mono); font-size: 10px; color: #374151; }
  .log-body { height: 106px; overflow-y: auto; padding: 6px 14px; display: flex; flex-direction: column; gap: 2px; }
  .log-line { font-family: var(--mono); font-size: 10px; line-height: 1.5; color: #5a7a5a; }
  .log-line.error { color: #ef4444; }
  .log-line.success { color: var(--green); }
  .log-line.warn { color: #f59e0b; }
  .log-line .ts { color: #2a2a3a; margin-right: 6px; }

  /* Running bar */
  .running-bar { background: rgba(232,184,75,.07); border-bottom: 1px solid rgba(232,184,75,.15); padding: 5px 14px; font-family: var(--mono); font-size: 10px; color: var(--gold); display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .spin { animation: spin 1s linear infinite; display: inline-block; }
  @keyframes spin { to { transform: rotate(360deg); } }
`;

export default function App() {
  const [profile, setProfile] = useState(null);
  const [leads, setLeads] = useState([]);
  const [logs, setLogs] = useState([
    { text: "APEX APPLY // System Initialized", type: "success" },
  ]);
  const [agentRunning, setAgentRunning] = useState(false);
  const [lastPlatform, setLastPlatform] = useState(null);
  const [filter, setFilter] = useState("TODAY");
  const [uploading, setUploading] = useState(false);
  const [logOpen, setLogOpen] = useState(true);
  const [profileExpanded, setProfileExpanded] = useState(false);
  const [currentActivity, setCurrentActivity] = useState({
    url: null,
    company: null,
    role: null,
    step: -1,
    score: null,
  });
  const logRef = useRef(null);
  const fileRef = useRef(null);

  const addLog = useCallback((text) => {
    const type =
      text.includes("❌") || text.includes("Error")
        ? "error"
        : text.includes("✅") || text.includes("Acquired")
          ? "success"
          : text.includes("⚠️") || text.includes("CAPTCHA")
            ? "warn"
            : "normal";
    const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
    setLogs((p) => [...p.slice(-199), { text, type, ts }]);
    setTimeout(
      () => logRef.current?.scrollTo(0, logRef.current.scrollHeight),
      50,
    );

    // Track live agent activity from log messages
    if (text.includes("🌐 Navigating to:")) {
      const url = text.split("🌐 Navigating to:")[1]?.trim();
      const company = url
        ?.split("/")
        .filter(Boolean)
        .pop()
        ?.split("?")[0]
        .replace(/-/g, " ")
        .toUpperCase();
      setCurrentActivity({ url, company, role: null, step: 0, score: null });
    }
    if (text.includes("[APP AGENT]")) {
      if (text.includes("📊 Scoring"))
        setCurrentActivity((p) => ({ ...p, step: 0 }));
      else if (text.includes("🔬 Fingerprinting"))
        setCurrentActivity((p) => ({ ...p, step: 1 }));
      else if (
        text.includes("⚡ Running deterministic") ||
        text.includes("🤖 Groq mapping")
      )
        setCurrentActivity((p) => ({ ...p, step: 2 }));
      else if (
        text.includes("📋 Total actions") ||
        text.includes("Resume attached")
      )
        setCurrentActivity((p) => ({ ...p, step: 3 }));
      else if (text.includes("🔍 Verifying"))
        setCurrentActivity((p) => ({ ...p, step: 4 }));
      else if (
        text.includes("✅ All fields") ||
        text.includes("🚫 Skipping") ||
        text.includes("APPLIED")
      )
        setCurrentActivity((p) => ({ ...p, step: 5 }));

      const scoreMatch = text.match(/Score: (\d+)\/100/);
      if (scoreMatch)
        setCurrentActivity((p) => ({ ...p, score: parseInt(scoreMatch[1]) }));
    }
  }, []);

  const fetchLeads = useCallback(async () => {
    try {
      const r = await fetch(`${SERVER}/api/leads`);
      const data = await r.json();
      if (Array.isArray(data)) setLeads(data);
    } catch {}
  }, []);

  const checkStatus = useCallback(async () => {
    try {
      const r = await fetch(`${SERVER}/api/status`);
      const d = await r.json();
      setAgentRunning(d.running);
    } catch {}
  }, []);

  useEffect(() => {
    fetchLeads();
    checkStatus();
    const li = setInterval(fetchLeads, 8000);
    const si = setInterval(checkStatus, 4000);
    return () => {
      clearInterval(li);
      clearInterval(si);
    };
  }, [fetchLeads, checkStatus]);

  useEffect(() => {
    socket.on("log", ({ message }) => addLog(message));
    socket.on("connect", () => addLog("◉ Socket connected"));
    socket.on("disconnect", () => addLog("◎ Socket disconnected"));
    return () => socket.off("log");
  }, [addLog]);

  useEffect(() => {
    const saved = localStorage.getItem("apexProfile");
    if (saved)
      try {
        setProfile(JSON.parse(saved));
      } catch {}
  }, []);

  const handleUpload = async (file) => {
    if (!file) return;
    setUploading(true);
    addLog("📄 Parsing resume...");
    const fd = new FormData();
    fd.append("resume", file);
    try {
      const r = await fetch(`${SERVER}/api/upload-resume`, {
        method: "POST",
        body: fd,
      });
      const d = await r.json();
      if (d.profile) {
        setProfile(d.profile);
        localStorage.setItem("apexProfile", JSON.stringify(d.profile));
        addLog(`✅ Resume parsed — ${d.profile.name}`);
      } else addLog(`❌ ${d.error || "Parse failed"}`);
    } catch (e) {
      addLog(`❌ Upload error: ${e.message}`);
    }
    setUploading(false);
  };

  const getFormProfile = () => ({
    ...profile,
    email: document.getElementById("f-email")?.value || profile?.email,
    phone: document.getElementById("f-phone")?.value || profile?.phone,
    location: document.getElementById("f-loc")?.value || profile?.location,
    minSalary: document.getElementById("f-min")?.value || "",
    maxSalary: document.getElementById("f-max")?.value || "",
    linkedinUrl:
      document.getElementById("f-linkedin")?.value ||
      profile?.linkedinUrl ||
      "",
    githubUrl:
      document.getElementById("f-github")?.value || profile?.githubUrl || "",
    portfolioUrl:
      document.getElementById("f-portfolio")?.value ||
      profile?.portfolioUrl ||
      "",
    educationSchool:
      document.getElementById("f-school")?.value ||
      profile?.educationSchool ||
      "",
    educationDegree:
      document.getElementById("f-degree")?.value ||
      profile?.educationDegree ||
      "",
    educationField:
      document.getElementById("f-discipline")?.value ||
      profile?.educationField ||
      "",
    educationStartYear:
      document.getElementById("f-startyear")?.value ||
      profile?.educationStartYear ||
      "",
    educationEndYear:
      document.getElementById("f-endyear")?.value ||
      profile?.educationEndYear ||
      "",
    willingToRelocate:
      document.getElementById("f-relocate")?.value ||
      profile?.willingToRelocate ||
      "No",
    skills:
      (document.getElementById("f-skills")?.value || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean).length > 0
        ? (document.getElementById("f-skills")?.value || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : profile?.skills || [],
    whyHireYou:
      document.getElementById("f-whyhire")?.value || profile?.whyHireYou || "",
  });

  const deployAgent = async (platform) => {
    if (!profile) return addLog("❌ Upload resume first.");
    if (agentRunning) return addLog("⚠️ Agent already running.");
    setLastPlatform(platform);
    addLog(`🚀 Deploying ${platform} engine...`);
    setAgentRunning(true);
    setCurrentActivity({
      url: null,
      company: null,
      role: null,
      step: -1,
      score: null,
    });
    try {
      await fetch(`${SERVER}/api/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: getFormProfile(), platform }),
      });
      fetchLeads();
    } catch (e) {
      addLog(`❌ ${e.message}`);
      setAgentRunning(false);
    }
  };

  const stopAgent = async () => {
    await fetch(`${SERVER}/api/stop`, { method: "POST" });
    setAgentRunning(false);
    addLog("⏹ Agent stopped.");
  };

  const deleteLead = async (id) => {
    await fetch(`${SERVER}/api/leads/${id}`, { method: "DELETE" });
    setLeads((p) => p.filter((l) => l._id !== id));
  };

  const retryLead = async (id) => {
    try {
      await fetch(`${SERVER}/api/leads/${id}/retry`, { method: "POST" });
      fetchLeads();
      addLog("🔄 Lead reset to DISCOVERED — will be picked up next run.");
    } catch {
      addLog("❌ Retry failed.");
    }
  };

  const retryAll = async (statuses) => {
    try {
      const r = await fetch(`${SERVER}/api/leads/retry/all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statuses }),
      });
      const d = await r.json();
      fetchLeads();
      addLog(`🔄 ${d.message}`);
    } catch {
      addLog("❌ Retry all failed.");
    }
  };

  const markManualDone = () => {
    socket.emit("skip_wait");
    addLog("✅ Marked as done — agent moving to next job.");
  };

  const nukeLeads = async () => {
    if (!window.confirm("Clear all leads from database?")) return;
    await fetch(`${SERVER}/api/leads/clear/all`, { method: "DELETE" });
    setLeads([]);
    addLog("🗑️ All leads cleared.");
  };

  const isToday = (dateStr) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    const now = new Date();
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    );
  };

  const total = leads.length;
  const applied = leads.filter((l) => l.status === "APPLIED").length;
  const pending = leads.filter((l) => l.status === "DISCOVERED").length;
  const manual = leads.filter(
    (l) => l.status === "MANUAL_REVIEW_NEEDED",
  ).length;
  const failed = leads.filter(
    (l) =>
      l.status === "FAILED" ||
      l.status === "CAPTCHA_BLOCKED" ||
      l.status === "FAILED_NEEDS_HEALING",
  ).length;
  const rate = total > 0 ? Math.round((applied / total) * 100) : 0;

  // ── Today-only stats ────────────────────────────────────────────────────
  const todayLeads = leads.filter((l) => isToday(l.createdAt));
  const todayTotal = todayLeads.length;
  const todayApplied = todayLeads.filter((l) => l.status === "APPLIED").length;
  const todayPending = todayLeads.filter(
    (l) => l.status === "DISCOVERED",
  ).length;
  const todayManual = todayLeads.filter(
    (l) => l.status === "MANUAL_REVIEW_NEEDED",
  ).length;
  const todayFailed = todayLeads.filter((l) =>
    ["FAILED", "CAPTCHA_BLOCKED", "FAILED_NEEDS_HEALING"].includes(l.status),
  ).length;
  const todayRate =
    todayTotal > 0 ? Math.round((todayApplied / todayTotal) * 100) : 0;

  const FILTERS = [
    "TODAY",
    "HISTORY",
    "ALL",
    "DISCOVERED",
    "APPLYING",
    "APPLIED",
    "MANUAL_REVIEW_NEEDED",
    "FAILED",
    "FAILED_NEEDS_HEALING",
  ];

  const filtered =
    filter === "ALL"
      ? leads
      : filter === "TODAY"
        ? leads.filter((l) => isToday(l.createdAt))
        : filter === "HISTORY"
          ? leads.filter((l) => !isToday(l.createdAt))
          : leads.filter((l) => l.status === filter);

  // For retry-all: which statuses are retryable in current filter
  const retryableStatuses = [
    "FAILED",
    "FAILED_NEEDS_HEALING",
    "MANUAL_REVIEW_NEEDED",
    "CAPTCHA_BLOCKED",
  ];
  const showRetryAll =
    [
      "FAILED",
      "FAILED_NEEDS_HEALING",
      "MANUAL_REVIEW_NEEDED",
      "CAPTCHA_BLOCKED",
    ].includes(filter) ||
    (filter !== "ALL" &&
      filter !== "TODAY" &&
      filter !== "HISTORY" &&
      filter !== "DISCOVERED" &&
      filter !== "APPLYING" &&
      filter !== "APPLIED");
  const queue = leads.filter((l) => l.status === "DISCOVERED").slice(0, 4);

  return (
    <>
      <style>{css}</style>
      <div className="app">
        {/* ── TOPBAR ── */}
        <header className="topbar">
          <div className="logo">
            APEX<span>//</span>APPLY
          </div>
          <div className={`status-pill ${agentRunning ? "on" : ""}`}>
            <div className={`dot ${agentRunning ? "on" : ""}`} />
            {agentRunning ? "AGENT ACTIVE" : "STANDBY"}
          </div>
          <div className="topbar-right">
            {!agentRunning ? (
              <>
                {["Google", "LinkedIn", "Naukri"].map((p) => {
                  const isReady = p === "Google";
                  return (
                    <button
                      key={p}
                      className="tbtn go"
                      onClick={() => isReady && deployAgent(p)}
                      disabled={!profile || !isReady}
                      title={!isReady ? `${p} engine coming soon` : undefined}
                      style={
                        !isReady ? { opacity: 0.35, cursor: "not-allowed" } : {}
                      }
                    >
                      ▶ {p}
                      {!isReady ? " 🔒" : ""}
                    </button>
                  );
                })}
              </>
            ) : (
              <button className="tbtn stop" onClick={stopAgent}>
                ■ Stop
              </button>
            )}
            <button className="tbtn" onClick={fetchLeads}>
              ⟳
            </button>
            <button className="tbtn danger" onClick={nukeLeads}>
              ✕ Nuke
            </button>
          </div>
        </header>

        <div className="body">
          {/* ── SIDEBAR ── */}
          <aside className="sidebar">
            {/* Live agent */}
            <div className="sb-section">
              <div className="sb-label">
                <span>{agentRunning ? "⬤ Live agent" : "◎ Agent idle"}</span>
              </div>
              {agentRunning && currentActivity.step >= 0 ? (
                <>
                  <div className="live-company">
                    {currentActivity.company || "—"}
                  </div>
                  <div className="live-role">
                    {currentActivity.role || "Processing..."}
                  </div>
                  {STEPS.map((s, i) => {
                    const state =
                      i < currentActivity.step
                        ? "done"
                        : i === currentActivity.step
                          ? "active"
                          : "wait";
                    return (
                      <div className="step-row" key={s}>
                        <div className={`step-ic ${state}`}>
                          {state === "done"
                            ? "✓"
                            : state === "active"
                              ? "●"
                              : "○"}
                        </div>
                        <span className={`step-label ${state}`}>{s}</span>
                      </div>
                    );
                  })}
                  {currentActivity.score !== null && (
                    <div className="rel-wrap">
                      <div className="rel-top">
                        <span>Relevance</span>
                        <span
                          style={{
                            color:
                              currentActivity.score > 60
                                ? "var(--green)"
                                : "var(--gold)",
                          }}
                        >
                          {currentActivity.score}%
                        </span>
                      </div>
                      <div className="rel-bar">
                        <div
                          className="rel-fill"
                          style={{ width: `${currentActivity.score}%` }}
                        />
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="idle-state">
                  {agentRunning
                    ? "Waiting for next job..."
                    : "Deploy an engine to start"}
                </div>
              )}
            </div>

            {/* Queue */}
            {queue.length > 0 && (
              <div className="sb-section">
                <div className="sb-label">Up next ({queue.length})</div>
                {queue.map((j) => (
                  <div className="q-item" key={j._id}>
                    <div className="q-dot" />
                    <div>
                      <div className="q-company">{j.company}</div>
                      <div className="q-role">{j.jobTitle}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Resume upload */}
            <div className="sb-section">
              <div className="sb-label">Resume</div>
              <div
                className={`upload-zone ${profile ? "loaded" : ""}`}
                onClick={() => fileRef.current?.click()}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf"
                  onChange={(e) => handleUpload(e.target.files[0])}
                />
                <div style={{ fontSize: 18, marginBottom: 4 }}>
                  {uploading ? "⏳" : profile ? "✅" : "📄"}
                </div>
                <div className="upload-text">
                  {uploading
                    ? "Parsing..."
                    : profile
                      ? profile.name
                      : "Drop PDF or click to upload"}
                </div>
              </div>
            </div>

            {/* Profile */}
            {profile && (
              <div className="sb-section">
                <div className="sb-label">
                  <span>Profile</span>
                  <span
                    className="sb-label-action"
                    onClick={() => setProfileExpanded((p) => !p)}
                  >
                    {profileExpanded ? "▲ collapse" : "▼ edit"}
                  </span>
                </div>
                {!profileExpanded ? (
                  <>
                    <div className="profile-row">
                      <span className="pk">Email</span>
                      <span className="pv">{profile.email}</span>
                    </div>
                    <div className="profile-row">
                      <span className="pk">Phone</span>
                      <span className="pv">{profile.phone}</span>
                    </div>
                    <div className="profile-row">
                      <span className="pk">Location</span>
                      <span className="pv">{profile.location || "Remote"}</span>
                    </div>
                    <div className="profile-row">
                      <span className="pk">Exp</span>
                      <span className="pv">
                        {profile.yearsOfExperience || "—"} yrs
                      </span>
                    </div>
                    {profile.titles?.length > 0 && (
                      <div style={{ marginTop: 6 }}>
                        {profile.titles.map((t, i) => (
                          <span key={i} className="role-tag">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div>
                    <div className="field">
                      <label>Email</label>
                      <input id="f-email" defaultValue={profile.email} />
                    </div>
                    <div className="field-row">
                      <div className="field">
                        <label>Phone</label>
                        <input id="f-phone" defaultValue={profile.phone} />
                      </div>
                      <div className="field">
                        <label>Location</label>
                        <input id="f-loc" defaultValue={profile.location} />
                      </div>
                    </div>
                    <div className="field-row">
                      <div className="field">
                        <label>Min Salary</label>
                        <input id="f-min" placeholder="$80,000" />
                      </div>
                      <div className="field">
                        <label>Max Salary</label>
                        <input id="f-max" placeholder="$120,000" />
                      </div>
                    </div>
                    <div className="field">
                      <label>LinkedIn</label>
                      <input
                        id="f-linkedin"
                        defaultValue={profile.linkedinUrl || ""}
                      />
                    </div>
                    <div className="field">
                      <label>GitHub</label>
                      <input
                        id="f-github"
                        defaultValue={profile.githubUrl || ""}
                      />
                    </div>
                    <div className="field">
                      <label>Portfolio</label>
                      <input
                        id="f-portfolio"
                        defaultValue={profile.portfolioUrl || ""}
                      />
                    </div>
                    <div
                      style={{
                        marginTop: 8,
                        marginBottom: 4,
                        fontFamily: "var(--mono)",
                        fontSize: "9px",
                        color: "var(--muted)",
                        textTransform: "uppercase",
                        letterSpacing: ".1em",
                      }}
                    >
                      Education
                    </div>
                    <div className="field">
                      <label>School / University</label>
                      <input
                        id="f-school"
                        defaultValue={profile.educationSchool || ""}
                        placeholder="e.g. VIT University"
                      />
                    </div>
                    <div className="field">
                      <label>Degree</label>
                      <input
                        id="f-degree"
                        defaultValue={profile.educationDegree || ""}
                        placeholder="e.g. Bachelor's Degree"
                      />
                    </div>
                    <div className="field">
                      <label>Discipline / Major</label>
                      <input
                        id="f-discipline"
                        defaultValue={profile.educationField || ""}
                        placeholder="e.g. Computer Science"
                      />
                    </div>
                    <div className="field-row">
                      <div className="field">
                        <label>Start Year</label>
                        <input
                          id="f-startyear"
                          defaultValue={profile.educationStartYear || ""}
                          placeholder="2017"
                        />
                      </div>
                      <div className="field">
                        <label>End Year</label>
                        <input
                          id="f-endyear"
                          defaultValue={profile.educationEndYear || ""}
                          placeholder="2021"
                        />
                      </div>
                    </div>
                    <div className="field">
                      <label>Willing to Relocate?</label>
                      <select
                        id="f-relocate"
                        defaultValue={profile.willingToRelocate || "No"}
                        style={{
                          background: "var(--panel2)",
                          border: "1px solid var(--border2)",
                          borderRadius: 5,
                          padding: "7px 9px",
                          fontFamily: "var(--mono)",
                          fontSize: 11,
                          color: "var(--text)",
                          outline: "none",
                        }}
                      >
                        <option value="Yes">Yes</option>
                        <option value="No">No</option>
                      </select>
                    </div>
                    <div className="field">
                      <label>Skills (comma-separated)</label>
                      <input
                        id="f-skills"
                        defaultValue={(profile.skills || []).join(", ")}
                        placeholder="React, Node.js, MongoDB, Python"
                      />
                    </div>
                    <div className="field">
                      <label>Why should we hire you?</label>
                      <textarea
                        id="f-whyhire"
                        defaultValue={profile.whyHireYou || ""}
                        placeholder="Write 2-3 sentences about your fit for the role..."
                        style={{
                          background: "var(--panel2)",
                          border: "1px solid var(--border2)",
                          borderRadius: 5,
                          padding: "7px 9px",
                          fontFamily: "var(--mono)",
                          fontSize: 11,
                          color: "var(--text)",
                          outline: "none",
                          resize: "vertical",
                          minHeight: 72,
                          width: "100%",
                        }}
                      />
                    </div>
                    <button
                      onClick={() => {
                        const updated = {
                          ...profile,
                          email:
                            document.getElementById("f-email")?.value ||
                            profile.email,
                          phone:
                            document.getElementById("f-phone")?.value ||
                            profile.phone,
                          location:
                            document.getElementById("f-loc")?.value ||
                            profile.location,
                          minSalary:
                            document.getElementById("f-min")?.value || "",
                          maxSalary:
                            document.getElementById("f-max")?.value || "",
                          linkedinUrl:
                            document.getElementById("f-linkedin")?.value ||
                            profile.linkedinUrl ||
                            "",
                          githubUrl:
                            document.getElementById("f-github")?.value ||
                            profile.githubUrl ||
                            "",
                          portfolioUrl:
                            document.getElementById("f-portfolio")?.value ||
                            profile.portfolioUrl ||
                            "",
                          educationSchool:
                            document.getElementById("f-school")?.value ||
                            profile.educationSchool ||
                            "",
                          educationDegree:
                            document.getElementById("f-degree")?.value ||
                            profile.educationDegree ||
                            "",
                          educationField:
                            document.getElementById("f-discipline")?.value ||
                            profile.educationField ||
                            "",
                          educationStartYear:
                            document.getElementById("f-startyear")?.value ||
                            profile.educationStartYear ||
                            "",
                          educationEndYear:
                            document.getElementById("f-endyear")?.value ||
                            profile.educationEndYear ||
                            "",
                          willingToRelocate:
                            document.getElementById("f-relocate")?.value ||
                            "No",
                          skills: (
                            document.getElementById("f-skills")?.value || ""
                          )
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                          whyHireYou:
                            document.getElementById("f-whyhire")?.value || "",
                        };
                        setProfile(updated);
                        localStorage.setItem(
                          "apexProfile",
                          JSON.stringify(updated),
                        );
                        addLog("✅ Profile saved.");
                        setProfileExpanded(false);
                      }}
                      style={{
                        width: "100%",
                        marginTop: 8,
                        padding: "8px",
                        background: "rgba(232,184,75,0.12)",
                        border: "1px solid rgba(232,184,75,0.4)",
                        borderRadius: 5,
                        color: "var(--gold)",
                        fontFamily: "var(--mono)",
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: "pointer",
                        letterSpacing: ".08em",
                      }}
                    >
                      💾 SAVE PROFILE
                    </button>
                  </div>
                )}
              </div>
            )}
          </aside>

          {/* ── MAIN ── */}
          <main className="main">
            {/* ── TODAY Stats ── */}
            <div
              className="stats-strip"
              style={{
                borderBottom: "1px solid var(--border)",
                paddingBottom: 12,
                marginBottom: 0,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 8,
                  width: "100%",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 9,
                    letterSpacing: ".15em",
                    color: "var(--gold)",
                    fontWeight: 700,
                  }}
                >
                  ⚡ TODAY
                </span>
                <div
                  style={{
                    flex: 1,
                    height: 1,
                    background: "rgba(232,184,75,0.2)",
                  }}
                />
              </div>
              {[
                { val: fmt(todayTotal), lbl: "Found", color: "var(--text)" },
                {
                  val: fmt(todayApplied),
                  lbl: "Applied",
                  color: "var(--green)",
                },
                {
                  val: fmt(todayPending),
                  lbl: "Pending",
                  color: "var(--blue)",
                },
                { val: fmt(todayManual), lbl: "Review", color: "#f97316" },
                { val: fmt(todayFailed), lbl: "Failed", color: "var(--red)" },
                { val: `${todayRate}%`, lbl: "Rate", color: "var(--gold)" },
              ].map((s) => (
                <div className="stat" key={"t-" + s.lbl}>
                  <div
                    className="stat-val"
                    style={{ color: s.color, fontSize: 22 }}
                  >
                    {s.val}
                  </div>
                  <div className="stat-lbl">{s.lbl}</div>
                </div>
              ))}
            </div>

            {/* ── ALL TIME Stats ── */}
            <div
              className="stats-strip"
              style={{ paddingTop: 10, marginBottom: 4, opacity: 0.55 }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 8,
                  width: "100%",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 9,
                    letterSpacing: ".15em",
                    color: "var(--muted2)",
                    fontWeight: 700,
                  }}
                >
                  ALL TIME
                </span>
                <div
                  style={{ flex: 1, height: 1, background: "var(--border)" }}
                />
              </div>
              {[
                { val: fmt(total), lbl: "Total", color: "var(--text)" },
                { val: fmt(applied), lbl: "Applied", color: "var(--green)" },
                { val: fmt(pending), lbl: "Pending", color: "var(--blue)" },
                { val: fmt(manual), lbl: "Review", color: "#f97316" },
                { val: fmt(failed), lbl: "Failed", color: "var(--red)" },
                { val: `${rate}%`, lbl: "Rate", color: "var(--gold)" },
              ].map((s) => (
                <div className="stat" key={"a-" + s.lbl}>
                  <div
                    className="stat-val"
                    style={{ color: s.color, fontSize: 16 }}
                  >
                    {s.val}
                  </div>
                  <div className="stat-lbl" style={{ fontSize: 9 }}>
                    {s.lbl}
                  </div>
                </div>
              ))}
            </div>

            {agentRunning && (
              <div className="running-bar">
                <span className="spin">◌</span>
                Agent running — updates every 8 seconds
              </div>
            )}

            {/* Filters */}
            <div className="filters">
              {FILTERS.map((f) => {
                const count =
                  f === "ALL"
                    ? leads.length
                    : f === "TODAY"
                      ? todayTotal
                      : f === "HISTORY"
                        ? leads.filter((l) => !isToday(l.createdAt)).length
                        : leads.filter((l) => l.status === f).length;
                return (
                  <button
                    key={f}
                    className={`fbtn ${filter === f ? "active" : ""}`}
                    onClick={() => setFilter(f)}
                    style={
                      f === "TODAY"
                        ? {
                            borderColor: "var(--gold)",
                            color: filter === f ? undefined : "var(--gold)",
                          }
                        : f === "HISTORY"
                          ? {
                              borderColor: "var(--muted2)",
                              color: filter === f ? undefined : "var(--muted2)",
                            }
                          : {}
                    }
                  >
                    {f === "TODAY"
                      ? "⚡ Today"
                      : f === "HISTORY"
                        ? "🕓 History"
                        : f.replace(/_/g, " ")}
                    {count !== null && (
                      <span style={{ marginLeft: 4, opacity: 0.6 }}>
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
              <div
                className="filters-right"
                style={{ display: "flex", gap: 6, alignItems: "center" }}
              >
                {showRetryAll && filtered.length > 0 && (
                  <button
                    className="tbtn"
                    style={{
                      fontSize: 10,
                      borderColor: "var(--gold)",
                      color: "var(--gold)",
                    }}
                    onClick={() => retryAll(retryableStatuses)}
                  >
                    ⟳ Retry All (
                    {
                      filtered.filter((l) =>
                        retryableStatuses.includes(l.status),
                      ).length
                    }
                    )
                  </button>
                )}
                <button
                  className="tbtn"
                  style={{ fontSize: 10 }}
                  onClick={fetchLeads}
                >
                  ⟳ Refresh
                </button>
              </div>
            </div>

            {/* Job cards */}
            <div className="pipeline">
              {filtered.length === 0 ? (
                <div className="empty">
                  <div style={{ fontSize: 32, opacity: 0.3 }}>◎</div>
                  <div>
                    {filter === "ALL"
                      ? "No leads yet — deploy an engine to start"
                      : `No leads with status "${filter}"`}
                  </div>
                </div>
              ) : (
                filtered.map((lead) => {
                  const meta =
                    STATUS_META[lead.status] || STATUS_META.DISCOVERED;
                  const score = lead.relevanceScore;
                  const scoreClass =
                    score >= 60 ? "hi" : score >= 30 ? "md" : "lo";
                  const canRetry = [
                    "FAILED",
                    "FAILED_NEEDS_HEALING",
                    "MANUAL_REVIEW_NEEDED",
                    "CAPTCHA_BLOCKED",
                  ].includes(lead.status);
                  return (
                    <div className="job-card" key={lead._id}>
                      <div>
                        <div className="jc-company">{lead.company}</div>
                        <div className="jc-role">{lead.jobTitle}</div>
                        <div className="jc-meta">
                          <span
                            className="badge"
                            style={{ color: meta.color, background: meta.bg }}
                          >
                            {meta.label}
                          </span>
                          {score !== null && score !== undefined && (
                            <div className="score-wrap">
                              <div className="score-bar">
                                <div
                                  className={`score-fill ${scoreClass}`}
                                  style={{ width: `${score}%` }}
                                />
                              </div>
                              <span>{score}%</span>
                            </div>
                          )}
                          {lead.skipReason && (
                            <span className="skip-reason">
                              {lead.skipReason}
                            </span>
                          )}
                          <span className="jc-time">
                            {timeAgo(lead.createdAt)}
                          </span>
                        </div>
                      </div>
                      <div className="jc-actions">
                        <a
                          className="ic-btn"
                          href={lead.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          ↗ Open
                        </a>
                        {lead.status === "MANUAL_REVIEW_NEEDED" &&
                          agentRunning && (
                            <button
                              className="ic-btn"
                              style={{
                                borderColor: "var(--green)",
                                color: "var(--green)",
                              }}
                              onClick={markManualDone}
                            >
                              ✓ Done
                            </button>
                          )}
                        {canRetry && (
                          <button
                            className="ic-btn retry"
                            onClick={() => retryLead(lead._id)}
                          >
                            ⟳ Retry
                          </button>
                        )}
                        <button
                          className="ic-btn del"
                          onClick={() => deleteLead(lead._id)}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Log panel */}
            <div className={`logpanel ${logOpen ? "open" : "closed"}`}>
              <div className="log-header" onClick={() => setLogOpen((p) => !p)}>
                <div className="log-dots">
                  <div className="ld" style={{ background: "#ff4560" }} />
                  <div className="ld" style={{ background: "#f5a623" }} />
                  <div className="ld" style={{ background: "#00e57a" }} />
                </div>
                <span className="log-title">AGENT LOG</span>
                <span className="log-toggle">{logOpen ? "▼" : "▲"}</span>
              </div>
              {logOpen && (
                <div className="log-body" ref={logRef}>
                  {logs.map((l, i) => (
                    <div key={i} className={`log-line ${l.type || ""}`}>
                      {l.ts && <span className="ts">[{l.ts}]</span>}
                      {l.text}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
    </>
  );
}
