import { useState, useEffect, useRef, useCallback } from "react";
import { io } from "socket.io-client";
import Login from "./Login";
import Landing from "./Landing";
import AdminDashboard from "./AdminDashboard";
import StatsCard from "./StatsCard";

const SERVER = "http://localhost:5000";
// withCredentials — required so the session cookie is sent on the socket
// handshake, which is how the server knows which user's room to join you to.
const socket = io(SERVER, { withCredentials: true });

// apiFetch — every request includes the session cookie. Plain fetch() would
// silently drop it and every protected route would 401.
const apiFetch = (url, opts = {}) =>
  fetch(url, { ...opts, credentials: "include" });

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
    color: "#2563EB",
    bg: "rgba(37,99,235,0.10)",
  },
  ANALYZING_FORM: {
    label: "Analyzing",
    color: "#7C3AED",
    bg: "rgba(124,58,237,0.10)",
  },
  APPLYING: {
    label: "Applying",
    color: "#D97706",
    bg: "rgba(217,119,6,0.10)",
  },
  APPLIED: {
    label: "Applied ✓",
    color: "#16A34A",
    bg: "rgba(22,163,74,0.10)",
  },
  MANUAL_REVIEW_NEEDED: {
    label: "Manual review",
    color: "#EA580C",
    bg: "rgba(234,88,12,0.10)",
  },
  FAILED_NEEDS_HEALING: {
    label: "Needs healing",
    color: "#DB2777",
    bg: "rgba(219,39,119,0.10)",
  },
  CAPTCHA_BLOCKED: {
    label: "Captcha",
    color: "#DC2626",
    bg: "rgba(220,38,38,0.10)",
  },
  ACCOUNT_SETUP_NEEDED: {
    label: "Sign in needed",
    color: "#0891B2",
    bg: "rgba(8,145,178,0.10)",
  },
  RESPONDED: {
    label: "Responded",
    color: "#65A30D",
    bg: "rgba(101,163,13,0.10)",
  },
  FAILED: { label: "Failed", color: "#6B7280", bg: "rgba(107,114,128,0.12)" },
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
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@300;400;500&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    /* Light theme — variable NAMES kept as-is (--gold etc.) so every existing
       reference below still works; only the VALUES changed. --gold is now
       indigo, not gold — kept the name to avoid rewriting ~40 references. */
    --bg: #F7F8FA; --panel: #FFFFFF; --panel2: #F3F4F6;
    --border: #E5E7EB; --border2: #D1D5DB;
    --gold: #4F46E5; --gold2: #6366F1;
    --green: #16A34A; --red: #DC2626; --blue: #2563EB;
    --text: #111827; --muted: #9CA3AF; --muted2: #4B5563;
    --font: 'Inter', sans-serif; --mono: 'JetBrains Mono', monospace;
    /* Dedicated to the Agent Log panel only — deliberately kept dark as a
       self-contained "console" island (same pattern as Vercel/GitHub Actions
       build logs), independent of the rest of the now-light theme. */
    --console-bg: #0B0D12; --console-border: #1F2330;
    --console-text: #8FA88F; --console-muted: #4B5168;
  }
  html, body, #root { height: 100%; background: var(--bg); color: var(--text); font-family: var(--font); }
  ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }

  /* ── Layout ── */
  .app { display: grid; grid-template-rows: 52px 1fr; height: 100vh; overflow: hidden; }
  .body { display: grid; grid-template-columns: 310px 1fr; overflow: hidden; }
  .main { display: flex; flex-direction: column; overflow: hidden; }

  /* ── Topbar ── */
  .topbar { display: flex; align-items: center; justify-content: space-between; padding: 0 20px; border-bottom: 1px solid var(--border); background: var(--panel); position: relative; z-index: 10; box-shadow: 0 1px 2px rgba(17,24,39,0.03); }
  .topbar::after { content:''; position:absolute; bottom:0; left:0; right:0; height:2px; background: linear-gradient(90deg,transparent,var(--gold),transparent); }
  .logo { font-size: 15px; font-weight: 800; letter-spacing: .04em; font-family: var(--font); }
  .logo span { color: var(--gold); }
  .status-pill { display: flex; align-items: center; gap: 6px; background: var(--panel2); border: 1px solid var(--border2); border-radius: 20px; padding: 4px 12px; font-family: var(--font); font-weight: 500; font-size: 11px; color: var(--muted2); }
  .status-pill.on { border-color: rgba(22,163,74,.3); background: rgba(22,163,74,.08); color: var(--green); }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); }
  .dot.on { background: var(--green); animation: pulse 2s infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
  .topbar-right { display: flex; gap: 8px; }
  .tbtn { background: var(--panel); border: 1px solid var(--border2); color: var(--muted2); border-radius: 7px; padding: 6px 12px; font-family: var(--font); font-weight: 500; font-size: 12px; cursor: pointer; transition: all .15s; }
  .tbtn:hover { color: var(--text); border-color: var(--muted); background: var(--panel2); }
  .tbtn.danger:hover { border-color: var(--red); color: var(--red); background: rgba(220,38,38,.06); }
  .tbtn.go { border-color: rgba(79,70,229,.35); color: var(--gold); background: rgba(79,70,229,.05); }
  .tbtn.go:hover { background: rgba(79,70,229,.1); }
  .tbtn.stop { border-color: rgba(220,38,38,.35); color: var(--red); background: rgba(220,38,38,.05); }
  .tbtn.stop:hover { background: rgba(220,38,38,.1); }

  /* ── Sidebar ── */
  .sidebar { background: var(--panel); border-right: 1px solid var(--border); display: flex; flex-direction: column; overflow-y: auto; overflow-x: hidden; gap: 0; }
  .sb-section { border-bottom: 1px solid var(--border); padding: 16px; }
  .sb-label { font-family: var(--font); font-weight: 700; font-size: 11px; letter-spacing: .04em; color: var(--muted2); text-transform: uppercase; margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between; }
  .sb-label-action { color: var(--muted); cursor: pointer; font-size: 11px; font-weight: 500; }
  .sb-label-action:hover { color: var(--gold); }

  /* Live agent */
  .live-company { font-size: 14px; font-weight: 700; color: var(--text); margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .live-role { font-family: var(--font); font-size: 12px; color: var(--muted2); margin-bottom: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .step-row { display: flex; align-items: center; gap: 7px; margin-bottom: 5px; font-family: var(--font); font-size: 12px; }
  .step-ic { width: 17px; height: 17px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 8px; flex-shrink: 0; }
  .step-ic.done { background: #DCFCE7; color: #16A34A; }
  .step-ic.active { background: #E0E7FF; color: #4F46E5; animation: pulse 1s infinite; }
  .step-ic.wait { background: #F3F4F6; color: #C0C4CC; }
  .step-label.done { color: var(--muted2); }
  .step-label.active { color: var(--gold); font-weight: 600; }
  .step-label.wait { color: var(--muted); }
  .rel-wrap { margin-top: 10px; }
  .rel-top { display: flex; justify-content: space-between; font-family: var(--font); font-weight: 500; font-size: 11px; color: var(--muted); margin-bottom: 4px; }
  .rel-bar { background: var(--border); border-radius: 3px; height: 4px; overflow: hidden; }
  .rel-fill { height: 100%; border-radius: 3px; background: linear-gradient(90deg, #F59E0B, #16A34A); transition: width .5s; }
  .idle-state { font-family: var(--font); font-size: 12px; color: var(--muted); text-align: center; padding: 12px 0; }

  /* Queue */
  .q-item { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-bottom: 1px solid var(--border); }
  .q-item:last-child { border-bottom: none; }
  .q-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--panel2); border: 1px solid var(--border2); flex-shrink: 0; }
  .q-company { font-size: 12px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .q-role { font-family: var(--font); font-size: 11px; color: var(--muted); }

  /* Profile */
  .profile-row { display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 12px; }
  .pk { font-family: var(--font); font-weight: 500; font-size: 11px; color: var(--muted); }
  .pv { color: var(--text); text-align: right; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 9px; }
  .field label { font-family: var(--font); font-weight: 600; font-size: 11px; letter-spacing: .02em; color: var(--muted2); text-transform: uppercase; }
  .field input { background: var(--panel); border: 1px solid var(--border2); border-radius: 7px; padding: 8px 10px; font-family: var(--font); font-size: 13px; color: var(--text); outline: none; transition: border-color .15s, box-shadow .15s; }
  .field input:focus { border-color: var(--gold); box-shadow: 0 0 0 3px rgba(79,70,229,.12); }
  .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .role-tag { display: inline-block; margin: 2px; background: rgba(79,70,229,.08); border: 1px solid rgba(79,70,229,.18); color: var(--gold); font-family: var(--font); font-weight: 500; font-size: 11px; padding: 3px 9px; border-radius: 999px; }

  /* Upload */
  .upload-zone { border: 1.5px dashed var(--border2); border-radius: 10px; padding: 16px; text-align: center; cursor: pointer; background: var(--panel2); position: relative; transition: all .2s; }
  .upload-zone:hover { border-color: var(--gold); background: rgba(79,70,229,.04); }
  .upload-zone input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; }
  .upload-zone.loaded { border-color: var(--green); background: rgba(22,163,74,.05); }
  .upload-text { font-family: var(--font); font-size: 12px; color: var(--muted2); margin-top: 4px; }
  .upload-zone.loaded .upload-text { color: var(--green); font-weight: 600; }

  /* Deploy */
  .deploy-btn { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-radius: 8px; border: 1px solid var(--border2); background: var(--panel); cursor: pointer; font-family: var(--font); font-size: 13px; font-weight: 600; color: var(--text); width: 100%; margin-bottom: 7px; transition: all .15s; }
  .deploy-btn:hover:not(:disabled) { border-color: var(--gold); background: rgba(79,70,229,.05); box-shadow: 0 1px 2px rgba(17,24,39,0.04); }
  .deploy-btn:disabled { opacity: .45; cursor: not-allowed; }
  .deploy-btn .arrow { color: var(--muted); }
  .btn-stop { width: 100%; padding: 10px 14px; border-radius: 8px; border: 1px solid rgba(220,38,38,.25); background: rgba(220,38,38,.06); color: var(--red); cursor: pointer; font-family: var(--font); font-size: 13px; font-weight: 700; transition: all .15s; }
  .btn-stop:hover { background: rgba(220,38,38,.12); }

  /* Stats */
  .stats-strip { display: flex; flex-wrap: wrap; background: var(--panel); border-bottom: 1px solid var(--border); flex-shrink: 0; align-items: flex-end; padding: 12px 16px; gap: 0; }
  .stat { padding: 4px 16px 4px 0; min-width: 80px; }
  .stats-strip-label { display: flex; align-items: center; gap: 8px; width: 100%; margin-bottom: 6px; }
  .stat-val { font-size: 22px; font-weight: 800; line-height: 1; font-family: var(--font); }
  .stat-lbl { font-family: var(--font); font-weight: 600; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .03em; margin-top: 4px; }

  /* Filters */
  .filters { display: flex; align-items: center; gap: 6px; padding: 12px 16px; border-bottom: 1px solid var(--border); flex-shrink: 0; overflow-x: auto; }
  .fbtn { padding: 5px 12px; border-radius: 999px; border: 1px solid var(--border2); background: var(--panel); color: var(--muted2); font-family: var(--font); font-weight: 500; font-size: 12px; cursor: pointer; white-space: nowrap; transition: all .15s; }
  .fbtn.active { background: var(--gold); border-color: var(--gold); color: #fff; font-weight: 600; }
  .fbtn:not(.active):hover { border-color: var(--muted); color: var(--text); background: var(--panel2); }
  .filters-right { margin-left: auto; display: flex; gap: 6px; }

  /* Cards */
  .pipeline { flex: 1; overflow-y: auto; padding: 14px 16px; background: var(--bg); }
  .job-card { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; margin-bottom: 10px; display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: start; transition: all .15s; box-shadow: 0 1px 2px rgba(17,24,39,0.04); }
  .job-card:hover { border-color: var(--border2); box-shadow: 0 2px 8px rgba(17,24,39,0.07); transform: translateY(-1px); }
  .jc-company { font-size: 14px; font-weight: 700; color: var(--text); margin-bottom: 2px; }
  .jc-role { font-family: var(--font); font-size: 12px; color: var(--muted2); margin-bottom: 9px; }
  .jc-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 999px; font-family: var(--font); font-size: 11px; letter-spacing: .01em; font-weight: 600; }
  .score-wrap { display: flex; align-items: center; gap: 5px; font-family: var(--font); font-weight: 500; font-size: 11px; color: var(--muted); }
  .score-bar { width: 36px; height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; }
  .score-fill { height: 100%; border-radius: 2px; }
  .score-fill.hi { background: var(--green); }
  .score-fill.md { background: var(--gold); }
  .score-fill.lo { background: var(--red); }
  .skip-reason { font-family: var(--font); font-size: 11px; color: var(--muted); }
  .jc-time { font-family: var(--font); font-size: 11px; color: var(--muted); }
  .jc-actions { display: flex; flex-direction: column; gap: 5px; align-items: flex-end; }
  .ic-btn { background: var(--panel); border: 1px solid var(--border2); border-radius: 6px; padding: 5px 11px; font-family: var(--font); font-weight: 500; font-size: 11px; color: var(--muted2); cursor: pointer; transition: all .15s; white-space: nowrap; }
  .ic-btn:hover { color: var(--text); border-color: var(--muted); background: var(--panel2); }
  .ic-btn.del:hover { color: var(--red); border-color: rgba(220,38,38,.4); }
  .ic-btn.retry:hover { color: var(--gold); border-color: rgba(79,70,229,.4); }
  .empty { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 200px; color: var(--muted); font-family: var(--font); font-size: 13px; gap: 8px; }

  /* Log panel — deliberately kept as a dark "console" island (same idea as
     Vercel/GitHub Actions build logs sitting inside an otherwise light UI),
     using the dedicated --console-* variables instead of the main theme. */
  .logpanel { border-top: 1px solid var(--border); background: var(--console-bg); flex-shrink: 0; transition: height .2s; }
  .logpanel.open { height: 140px; }
  .logpanel.closed { height: 34px; }
  .log-header { display: flex; align-items: center; gap: 8px; padding: 6px 14px; border-bottom: 1px solid var(--console-border); cursor: pointer; height: 34px; }
  .log-dots { display: flex; gap: 4px; }
  .ld { width: 8px; height: 8px; border-radius: 50%; }
  .log-title { font-family: var(--mono); font-size: 10px; color: var(--console-muted); letter-spacing: .08em; margin-right: auto; }
  .log-toggle { font-family: var(--mono); font-size: 10px; color: var(--console-muted); }
  .log-body { height: 106px; overflow-y: auto; padding: 6px 14px; display: flex; flex-direction: column; gap: 2px; }
  .log-line { font-family: var(--mono); font-size: 10px; line-height: 1.5; color: var(--console-text); }
  .log-line.error { color: #f87171; }
  .log-line.success { color: #4ade80; }
  .log-line.warn { color: #fbbf24; }
  .log-line .ts { color: var(--console-muted); margin-right: 6px; }

  /* Running bar */
  .running-bar { background: rgba(79,70,229,.06); border-bottom: 1px solid rgba(79,70,229,.15); padding: 6px 16px; font-family: var(--font); font-weight: 500; font-size: 12px; color: var(--gold); display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .spin { animation: spin 1s linear infinite; display: inline-block; }
  @keyframes spin { to { transform: rotate(360deg); } }
`;

export default function App() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [showAuth, setShowAuth] = useState(false); // false = show Landing first
  const [authMode, setAuthMode] = useState("login"); // "login" | "register"
  const [showAdmin, setShowAdmin] = useState(false);
  const [showStatsCard, setShowStatsCard] = useState(false);
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
      const r = await apiFetch(`${SERVER}/api/leads`);
      const data = await r.json();
      if (Array.isArray(data)) setLeads(data);
    } catch {}
  }, []);

  const checkStatus = useCallback(async () => {
    try {
      const r = await apiFetch(`${SERVER}/api/status`);
      const d = await r.json();
      setAgentRunning(d.running);
    } catch {}
  }, []);

  useEffect(() => {
    if (!user) return;
    fetchLeads();
    checkStatus();
    const li = setInterval(fetchLeads, 8000);
    const si = setInterval(checkStatus, 4000);
    return () => {
      clearInterval(li);
      clearInterval(si);
    };
  }, [fetchLeads, checkStatus, user]);

  useEffect(() => {
    socket.on("log", ({ message }) => addLog(message));
    socket.on("connect", () => addLog("◉ Socket connected"));
    socket.on("disconnect", () => addLog("◎ Socket disconnected"));
    return () => {
      socket.off("log");
      socket.off("connect");
      socket.off("disconnect");
    };
  }, [addLog]);

  // On mount: check if a session already exists (refresh, reopened tab) and
  // pull the profile from the DATABASE — never from localStorage. This is
  // also the only place a logged-in user's profile gets populated.
  useEffect(() => {
    (async () => {
      try {
        const r = await apiFetch(`${SERVER}/api/me`);
        if (r.ok) {
          const d = await r.json();
          setUser(d.user);
          setProfile(d.user.profile || {});
        }
      } catch {}
      setAuthChecked(true);
    })();
  }, []);

  const handleLogout = async () => {
    try {
      await apiFetch(`${SERVER}/api/logout`, { method: "POST" });
    } catch {}
    setUser(null);
    setProfile(null);
    setLeads([]);
    setShowAuth(false);
    // Defense in depth — nothing should be relying on localStorage anymore,
    // but clear it anyway in case an old session left something behind.
    localStorage.removeItem("apexProfile");
  };

  const handleRemoveResume = async () => {
    if (!window.confirm("Remove your resume? You can upload a new one after."))
      return;
    try {
      const r = await apiFetch(`${SERVER}/api/resume`, { method: "DELETE" });
      const d = await r.json();
      if (r.ok) {
        setProfile(d.profile || {});
        addLog("🗑️ Resume removed.");
      } else {
        addLog(`❌ ${d.error || "Failed to remove resume"}`);
      }
    } catch (e) {
      addLog(`❌ Remove error: ${e.message}`);
    }
  };

  const handleUpload = async (file) => {
    if (!file) return;
    setUploading(true);
    addLog("📄 Parsing resume...");
    const fd = new FormData();
    fd.append("resume", file);
    try {
      const r = await apiFetch(`${SERVER}/api/upload-resume`, {
        method: "POST",
        body: fd,
      });
      const d = await r.json();
      if (d.profile) {
        setProfile(d.profile);
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
    if (!profile?.name) return addLog("❌ Upload resume first.");
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
      await apiFetch(`${SERVER}/api/start`, {
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
    await apiFetch(`${SERVER}/api/stop`, { method: "POST" });
    setAgentRunning(false);
    addLog("⏹ Agent stopped.");
  };

  const deleteLead = async (id) => {
    await apiFetch(`${SERVER}/api/leads/${id}`, { method: "DELETE" });
    setLeads((p) => p.filter((l) => l._id !== id));
  };

  const [respondingId, setRespondingId] = useState(null); // which card has the response picker open

  // Ticks every second so hold-countdowns (CAPTCHA / manual review / account
  // setup) render live. Deliberately independent of the socket — REST polling
  // already works even when the realtime log stream doesn't, so the
  // countdown shouldn't be hostage to the same connection.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const HOLD_STATUSES = [
    "MANUAL_REVIEW_NEEDED",
    "CAPTCHA_BLOCKED",
    "ACCOUNT_SETUP_NEEDED",
  ];
  const holdSecondsLeft = (lead) => {
    if (!HOLD_STATUSES.includes(lead.status) || !lead.holdStartedAt)
      return null;
    const elapsed = Math.floor(
      (now - new Date(lead.holdStartedAt).getTime()) / 1000,
    );
    const left = 90 - elapsed;
    return left > 0 ? left : 0;
  };

  const markResponded = async (id, responseType) => {
    try {
      const r = await apiFetch(`${SERVER}/api/leads/${id}/responded`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responseType }),
      });
      if (r.ok) {
        const { lead } = await r.json();
        setLeads((p) => p.map((l) => (l._id === id ? lead : l)));
      }
    } catch {
      /* non-fatal — just a self-reported outcome */
    } finally {
      setRespondingId(null);
    }
  };

  const retryLead = async (id) => {
    try {
      await apiFetch(`${SERVER}/api/leads/${id}/retry`, { method: "POST" });
      fetchLeads();
      addLog("🔄 Lead reset to DISCOVERED — will be picked up next run.");
    } catch {
      addLog("❌ Retry failed.");
    }
  };

  const retryAll = async (statuses) => {
    try {
      const r = await apiFetch(`${SERVER}/api/leads/retry/all`, {
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
    await apiFetch(`${SERVER}/api/leads/clear/all`, { method: "DELETE" });
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
  const responded = leads.filter((l) => l.status === "RESPONDED").length;
  const interviews = leads.filter(
    (l) => l.status === "RESPONDED" && l.responseType === "INTERVIEW",
  ).length;
  const earliestLeadDate = leads.length
    ? leads.reduce(
        (min, l) => (new Date(l.createdAt) < min ? new Date(l.createdAt) : min),
        new Date(leads[0].createdAt),
      )
    : new Date();
  const daysActive = Math.max(
    1,
    Math.ceil((Date.now() - earliestLeadDate.getTime()) / 86400000),
  );

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
    "ACCOUNT_SETUP_NEEDED",
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
    "ACCOUNT_SETUP_NEEDED",
  ];
  const showRetryAll =
    [
      "FAILED",
      "FAILED_NEEDS_HEALING",
      "MANUAL_REVIEW_NEEDED",
      "CAPTCHA_BLOCKED",
      "ACCOUNT_SETUP_NEEDED",
    ].includes(filter) ||
    (filter !== "ALL" &&
      filter !== "TODAY" &&
      filter !== "HISTORY" &&
      filter !== "DISCOVERED" &&
      filter !== "APPLYING" &&
      filter !== "APPLIED");
  const queue = leads.filter((l) => l.status === "DISCOVERED").slice(0, 4);

  // ── Auth gate ────────────────────────────────────────────────────────────
  // Don't render anything substantive until we know whether a session
  // exists — avoids a flash of the login screen on every reload.
  if (!authChecked) {
    return (
      <div
        style={{
          height: "100vh",
          background: "#F7F8FA",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#9CA3AF",
          fontFamily: "Inter, sans-serif",
          fontSize: 13,
        }}
      >
        Checking session...
      </div>
    );
  }
  if (!user) {
    if (!showAuth) {
      return (
        <Landing
          onGetStarted={() => {
            setAuthMode("register");
            setShowAuth(true);
          }}
          onLogin={() => {
            setAuthMode("login");
            setShowAuth(true);
          }}
        />
      );
    }
    return (
      <Login
        initialMode={authMode}
        onBack={() => setShowAuth(false)}
        onAuthenticated={(u) => {
          setUser(u);
          setProfile(u.profile || {});
        }}
      />
    );
  }

  if (showAdmin) {
    return <AdminDashboard onBack={() => setShowAdmin(false)} />;
  }

  return (
    <>
      <style>{css}</style>
      {showStatsCard && (
        <StatsCard
          stats={{ total, applied, responded, interviews, daysActive }}
          onClose={() => setShowStatsCard(false)}
        />
      )}
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
                      disabled={!profile?.name || !isReady}
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
            {user?.isAdmin && (
              <button
                className="tbtn"
                onClick={() => setShowAdmin(true)}
                style={{ borderColor: "#4F46E5", color: "#4F46E5" }}
              >
                ⚙ Admin
              </button>
            )}
            <button
              className="tbtn"
              onClick={handleLogout}
              title={user?.email}
              style={{ borderColor: "#D1D5DB" }}
            >
              ⏻ Logout
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
                className={`upload-zone ${profile?.name ? "loaded" : ""}`}
                onClick={() => fileRef.current?.click()}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf"
                  onChange={(e) => handleUpload(e.target.files[0])}
                />
                <div style={{ fontSize: 18, marginBottom: 4 }}>
                  {uploading ? "⏳" : profile?.name ? "✅" : "📄"}
                </div>
                <div className="upload-text">
                  {uploading
                    ? "Parsing..."
                    : profile?.name
                      ? profile.name
                      : "Drop PDF or click to upload"}
                </div>
              </div>
              {profile?.name && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveResume();
                  }}
                  style={{
                    width: "100%",
                    marginTop: 6,
                    padding: "6px",
                    background: "transparent",
                    border: "1px solid #FCA5A5",
                    borderRadius: 4,
                    color: "#ef4444",
                    fontSize: 11,
                    cursor: "pointer",
                  }}
                >
                  🗑 Remove resume
                </button>
              )}
            </div>

            {/* Profile */}
            {profile?.name && (
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
                        fontFamily: "var(--font)",
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
                          fontFamily: "var(--font)",
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
                          fontFamily: "var(--font)",
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
                      onClick={async () => {
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
                        try {
                          const r = await apiFetch(`${SERVER}/api/profile`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(updated),
                          });
                          const d = await r.json();
                          if (r.ok) {
                            setProfile(d.profile);
                            addLog("✅ Profile saved.");
                          } else {
                            addLog(`❌ ${d.error || "Save failed"}`);
                          }
                        } catch (e) {
                          addLog(`❌ Save error: ${e.message}`);
                        }
                        setProfileExpanded(false);
                      }}
                      style={{
                        width: "100%",
                        marginTop: 8,
                        padding: "9px",
                        background: "rgba(79,70,229,0.08)",
                        border: "1px solid rgba(79,70,229,0.35)",
                        borderRadius: 7,
                        color: "var(--gold)",
                        fontFamily: "var(--font)",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                        letterSpacing: ".01em",
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
                    fontFamily: "var(--font)",
                    fontSize: 11,
                    letterSpacing: ".04em",
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
                    background: "rgba(79,70,229,0.18)",
                  }}
                />
                <button
                  onClick={() => setShowStatsCard(true)}
                  style={{
                    background: "transparent",
                    border: "1px solid var(--gold)",
                    color: "var(--gold)",
                    fontFamily: "var(--font)",
                    fontSize: 9,
                    letterSpacing: ".08em",
                    padding: "4px 9px",
                    borderRadius: 5,
                    cursor: "pointer",
                  }}
                >
                  📤 SHARE
                </button>
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
                    fontFamily: "var(--font)",
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
                    "ACCOUNT_SETUP_NEEDED",
                  ].includes(lead.status);
                  const secondsLeft = holdSecondsLeft(lead);
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
                          {secondsLeft !== null && (
                            <span
                              style={{
                                fontFamily: "var(--font)",
                                fontSize: 10,
                                color:
                                  secondsLeft <= 15
                                    ? "var(--red)"
                                    : "var(--muted)",
                                border: "1px solid var(--border)",
                                borderRadius: 4,
                                padding: "2px 6px",
                              }}
                              title="Time left before Apex moves on without you"
                            >
                              ⏳ {secondsLeft}s
                            </span>
                          )}
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
                        {lead.status === "APPLIED" && (
                          <div style={{ position: "relative" }}>
                            <button
                              className="ic-btn"
                              style={{
                                borderColor: "var(--gold)",
                                color: "var(--gold)",
                              }}
                              onClick={() =>
                                setRespondingId((p) =>
                                  p === lead._id ? null : lead._id,
                                )
                              }
                            >
                              📨 Got a response?
                            </button>
                            {respondingId === lead._id && (
                              <div
                                style={{
                                  position: "absolute",
                                  top: "calc(100% + 4px)",
                                  right: 0,
                                  background: "var(--panel)",
                                  border: "1px solid var(--border)",
                                  borderRadius: 6,
                                  padding: 4,
                                  zIndex: 10,
                                  display: "flex",
                                  flexDirection: "column",
                                  minWidth: 130,
                                }}
                              >
                                {[
                                  ["INTERVIEW", "🎉 Interview"],
                                  ["ASSESSMENT", "📝 Assessment"],
                                  ["REJECTION", "Rejected"],
                                  ["OTHER", "Other reply"],
                                ].map(([val, label]) => (
                                  <button
                                    key={val}
                                    onClick={() => markResponded(lead._id, val)}
                                    style={{
                                      background: "transparent",
                                      border: "none",
                                      color: "var(--text)",
                                      fontSize: 11,
                                      padding: "6px 8px",
                                      textAlign: "left",
                                      cursor: "pointer",
                                      borderRadius: 4,
                                      fontFamily: "var(--font)",
                                    }}
                                    onMouseEnter={(e) =>
                                      (e.currentTarget.style.background =
                                        "var(--panel2)")
                                    }
                                    onMouseLeave={(e) =>
                                      (e.currentTarget.style.background =
                                        "transparent")
                                    }
                                  >
                                    {label}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        {lead.status === "RESPONDED" && (
                          <span
                            className="ic-btn"
                            style={{
                              borderColor: "var(--green)",
                              color: "var(--green)",
                              cursor: "default",
                            }}
                          >
                            {lead.responseType === "INTERVIEW"
                              ? "🎉 Interview"
                              : lead.responseType === "ASSESSMENT"
                                ? "📝 Assessment"
                                : lead.responseType === "REJECTION"
                                  ? "Rejected"
                                  : "Replied"}
                          </span>
                        )}
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
