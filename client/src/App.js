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
    label: "DISCOVERED",
    color: "#3b82f6",
    bg: "rgba(59,130,246,0.12)",
  },
  ANALYZING_FORM: {
    label: "ANALYZING",
    color: "#a78bfa",
    bg: "rgba(167,139,250,0.12)",
  },
  APPLYING: {
    label: "APPLYING",
    color: "#f59e0b",
    bg: "rgba(245,158,11,0.12)",
  },
  APPLIED: {
    label: "APPLIED ✓",
    color: "#10b981",
    bg: "rgba(16,185,129,0.12)",
  },
  MANUAL_REVIEW_NEEDED: {
    label: "MANUAL REVIEW",
    color: "#f97316",
    bg: "rgba(249,115,22,0.12)",
  },
  FAILED_NEEDS_HEALING: {
    label: "NEEDS HEALING",
    color: "#ec4899",
    bg: "rgba(236,72,153,0.12)",
  },
  CAPTCHA_BLOCKED: {
    label: "CAPTCHA",
    color: "#ef4444",
    bg: "rgba(239,68,68,0.12)",
  },
  FAILED: { label: "FAILED", color: "#6b7280", bg: "rgba(107,114,128,0.12)" },
};

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@300;400;500&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #08090b; --panel: #0d0f14; --panel2: #111318;
    --border: #1c1f2a; --border2: #252836;
    --gold: #e8b84b; --gold2: #f5d27a; --green: #00e57a; --red: #ff4560; --blue: #3b82f6;
    --text: #e8eaf0; --muted: #4a5068; --muted2: #6b7280;
    --font: 'Syne', sans-serif; --mono: 'JetBrains Mono', monospace;
  }
  html, body, #root { height: 100%; background: var(--bg); color: var(--text); font-family: var(--font); }
  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }
  .app { display: grid; grid-template-columns: 320px 1fr; grid-template-rows: 56px 1fr; height: 100vh; overflow: hidden; }
  .topbar { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; padding: 0 24px; border-bottom: 1px solid var(--border); background: var(--panel); position: relative; }
  .topbar::after { content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 1px; background: linear-gradient(90deg, transparent, var(--gold), transparent); }
  .logo { font-size: 15px; font-weight: 800; letter-spacing: 0.12em; color: var(--text); }
  .logo span { color: var(--gold); }
  .topbar-right { display: flex; align-items: center; gap: 12px; }
  .live-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--green); box-shadow: 0 0 8px var(--green); animation: pulse 2s infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
  .live-label { font-family: var(--mono); font-size: 11px; color: var(--muted2); letter-spacing: 0.08em; }
  .sidebar { background: var(--panel); border-right: 1px solid var(--border); display: flex; flex-direction: column; overflow-y: auto; overflow-x: hidden; padding: 20px 16px; gap: 16px; }
  .section-label { font-family: var(--mono); font-size: 10px; letter-spacing: 0.14em; color: var(--muted); text-transform: uppercase; margin-bottom: 8px; }
  .upload-zone { border: 1px dashed var(--border2); border-radius: 8px; padding: 18px; text-align: center; cursor: pointer; transition: all .2s; background: var(--panel2); position: relative; }
  .upload-zone:hover { border-color: var(--gold); background: rgba(232,184,75,0.04); }
  .upload-zone input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; }
  .upload-icon { font-size: 22px; margin-bottom: 6px; }
  .upload-text { font-size: 12px; color: var(--muted2); }
  .upload-loaded { background: rgba(0,229,122,0.06); border-color: var(--green); }
  .upload-loaded .upload-text { color: var(--green); }
  .field-group { display: flex; flex-direction: column; gap: 8px; }
  .field { display: flex; flex-direction: column; gap: 4px; }
  .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .field label { font-family: var(--mono); font-size: 9px; letter-spacing: 0.12em; color: var(--muted); text-transform: uppercase; }
  .field input { background: var(--panel2); border: 1px solid var(--border2); border-radius: 6px; padding: 8px 10px; font-family: var(--mono); font-size: 12px; color: var(--text); outline: none; transition: border-color .2s; }
  .field input:focus { border-color: var(--gold); }
  .roles-box { background: var(--panel2); border: 1px solid var(--border); border-radius: 8px; padding: 12px; }
  .role-tag { display: inline-block; margin: 3px 3px 0 0; background: rgba(232,184,75,0.1); border: 1px solid rgba(232,184,75,0.25); color: var(--gold2); font-family: var(--mono); font-size: 10px; padding: 3px 8px; border-radius: 4px; }
  .deploy-grid { display: flex; flex-direction: column; gap: 8px; }
  .btn-deploy { display: flex; align-items: center; justify-content: space-between; padding: 11px 14px; border-radius: 7px; border: 1px solid var(--border2); background: var(--panel2); cursor: pointer; transition: all .18s; font-family: var(--font); font-size: 13px; font-weight: 600; color: var(--text); }
  .btn-deploy:hover { border-color: var(--gold); background: rgba(232,184,75,0.06); transform: translateX(2px); }
  .btn-deploy:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
  .btn-deploy .platform-icon { font-size: 16px; }
  .btn-deploy .arrow { color: var(--muted); font-size: 12px; transition: color .18s; }
  .btn-deploy:hover .arrow { color: var(--gold); }
  .btn-stop { padding: 11px 14px; border-radius: 7px; border: 1px solid rgba(255,69,96,0.3); background: rgba(255,69,96,0.08); color: var(--red); cursor: pointer; font-family: var(--font); font-size: 13px; font-weight: 700; transition: all .18s; letter-spacing: 0.04em; }
  .btn-stop:hover { background: rgba(255,69,96,0.15); border-color: var(--red); }
  .main { display: flex; flex-direction: column; overflow: hidden; background: var(--bg); }
  .stats-row { display: grid; grid-template-columns: repeat(6, 1fr); gap: 1px; background: var(--border); border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .stat-card { background: var(--panel); padding: 14px 18px; display: flex; flex-direction: column; gap: 4px; }
  .stat-val { font-size: 26px; font-weight: 800; line-height: 1; }
  .stat-lbl { font-family: var(--mono); font-size: 9px; letter-spacing: 0.12em; color: var(--muted); text-transform: uppercase; }
  .stat-sub { font-family: var(--mono); font-size: 10px; color: var(--muted2); margin-top: 2px; }
  .filters { display: flex; align-items: center; gap: 6px; padding: 12px 20px; border-bottom: 1px solid var(--border); flex-shrink: 0; overflow-x: auto; }
  .filter-btn { padding: 5px 14px; border-radius: 5px; border: 1px solid var(--border2); background: transparent; color: var(--muted2); font-family: var(--mono); font-size: 11px; letter-spacing: 0.06em; cursor: pointer; transition: all .15s; white-space: nowrap; }
  .filter-btn.active { background: var(--gold); border-color: var(--gold); color: #000; font-weight: 700; }
  .filter-btn:not(.active):hover { border-color: var(--muted); color: var(--text); }
  .filters-right { margin-left: auto; display: flex; gap: 8px; }
  .btn-sm { padding: 5px 12px; border-radius: 5px; border: 1px solid var(--border2); background: transparent; font-family: var(--mono); font-size: 11px; color: var(--muted2); cursor: pointer; transition: all .15s; }
  .btn-sm:hover { border-color: var(--muted); color: var(--text); }
  .btn-sm.danger:hover { border-color: var(--red); color: var(--red); }
  .table-wrap { flex: 1; overflow-y: auto; }
  table { width: 100%; border-collapse: collapse; }
  thead { position: sticky; top: 0; z-index: 10; background: var(--panel); }
  th { padding: 10px 16px; text-align: left; font-family: var(--mono); font-size: 9px; letter-spacing: 0.14em; color: var(--muted); text-transform: uppercase; border-bottom: 1px solid var(--border); white-space: nowrap; }
  tr { border-bottom: 1px solid var(--border); transition: background .12s; }
  tr:hover { background: rgba(255,255,255,0.02); }
  td { padding: 12px 16px; font-size: 13px; vertical-align: middle; }
  .company-cell { display: flex; flex-direction: column; gap: 2px; }
  .company-name { font-weight: 700; font-size: 13px; color: var(--text); }
  .job-title { font-family: var(--mono); font-size: 11px; color: var(--muted2); }
  .status-badge { display: inline-flex; align-items: center; padding: 4px 9px; border-radius: 4px; font-family: var(--mono); font-size: 10px; letter-spacing: 0.06em; font-weight: 500; white-space: nowrap; }
  .link-btn { display: inline-flex; align-items: center; gap: 5px; color: var(--gold); font-family: var(--mono); font-size: 11px; text-decoration: none; padding: 4px 8px; border-radius: 4px; border: 1px solid rgba(232,184,75,0.2); transition: all .15s; }
  .link-btn:hover { background: rgba(232,184,75,0.1); border-color: var(--gold); }
  .date-cell { font-family: var(--mono); font-size: 11px; color: var(--muted2); }
  .action-btn { background: none; border: none; cursor: pointer; color: var(--muted); font-size: 14px; padding: 4px 6px; border-radius: 4px; transition: all .15s; }
  .action-btn:hover { color: var(--red); background: rgba(255,69,96,0.1); }
  .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 12px; color: var(--muted); font-family: var(--mono); font-size: 13px; text-align: center; }
  .empty-icon { font-size: 40px; opacity: .4; }
  .terminal { height: 150px; background: #060709; border-top: 1px solid var(--border); display: flex; flex-direction: column; flex-shrink: 0; }
  .terminal-header { display: flex; align-items: center; gap: 8px; padding: 6px 14px; border-bottom: 1px solid var(--border); background: var(--panel); }
  .term-dot { width: 8px; height: 8px; border-radius: 50%; }
  .term-title { font-family: var(--mono); font-size: 10px; color: var(--muted); letter-spacing: 0.08em; }
  .terminal-body { flex: 1; overflow-y: auto; padding: 8px 14px; display: flex; flex-direction: column; gap: 3px; }
  .log-line { font-family: var(--mono); font-size: 11px; line-height: 1.5; color: #6b8a6b; }
  .log-line.error { color: #ef4444; }
  .log-line.success { color: var(--green); }
  .log-line.warn { color: #f59e0b; }
  .log-line .ts { color: var(--muted); margin-right: 8px; }
  .agent-running-bar { background: rgba(232,184,75,0.08); border-bottom: 1px solid rgba(232,184,75,0.2); padding: 6px 20px; font-family: var(--mono); font-size: 11px; color: var(--gold); display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .spinner { animation: spin 1s linear infinite; display: inline-block; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .divider { height: 1px; background: var(--border); margin: 4px 0; }
`;

export default function App() {
  const [profile, setProfile] = useState(null);
  const [leads, setLeads] = useState([]);
  const [logs, setLogs] = useState([
    { text: "APEX APPLY // System Initialized", type: "success" },
  ]);
  const [agentRunning, setAgentRunning] = useState(false);
  const [lastPlatform, setLastPlatform] = useState(null); // for Resume button
  const [filter, setFilter] = useState("ALL");
  const [uploading, setUploading] = useState(false);
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
    const leadsInterval = setInterval(fetchLeads, 8000);
    const statusInterval = setInterval(checkStatus, 4000);
    return () => {
      clearInterval(leadsInterval);
      clearInterval(statusInterval);
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
      } else {
        addLog(`❌ ${d.error || "Parse failed"}`);
      }
    } catch (e) {
      addLog(`❌ Upload error: ${e.message}`);
    }
    setUploading(false);
  };

  const deployAgent = async (platform) => {
    if (!profile) return addLog("❌ Upload resume first.");
    if (agentRunning) return addLog("⚠️ Agent already running.");
    setLastPlatform(platform);
    const merged = {
      ...profile,
      email: document.getElementById("f-email")?.value || profile.email,
      phone: document.getElementById("f-phone")?.value || profile.phone,
      location: document.getElementById("f-loc")?.value || profile.location,
      minSalary: document.getElementById("f-min")?.value || "",
      maxSalary: document.getElementById("f-max")?.value || "",
      linkedinUrl:
        document.getElementById("f-linkedin")?.value ||
        profile.linkedinUrl ||
        "",
      githubUrl:
        document.getElementById("f-github")?.value || profile.githubUrl || "",
      portfolioUrl:
        document.getElementById("f-portfolio")?.value ||
        profile.portfolioUrl ||
        "",
    };
    addLog(`🚀 Deploying ${platform} engine...`);
    setAgentRunning(true);
    try {
      await fetch(`${SERVER}/api/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: merged, platform }),
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

  const nukeLeads = async () => {
    if (!window.confirm("Clear all leads from database?")) return;
    await fetch(`${SERVER}/api/leads/clear/all`, { method: "DELETE" });
    setLeads([]);
    addLog("🗑️ All leads cleared.");
  };

  const total = leads.length;
  const applied = leads.filter((l) => l.status === "APPLIED").length;
  const pending = leads.filter((l) => l.status === "DISCOVERED").length;
  const manual = leads.filter(
    (l) => l.status === "MANUAL_REVIEW_NEEDED",
  ).length;
  const failed = leads.filter(
    (l) => l.status === "FAILED" || l.status === "CAPTCHA_BLOCKED",
  ).length;
  const rate = total > 0 ? Math.round((applied / total) * 100) : 0;

  const FILTERS = [
    "ALL",
    "DISCOVERED",
    "APPLYING",
    "APPLIED",
    "MANUAL_REVIEW_NEEDED",
    "FAILED",
  ];
  const filtered =
    filter === "ALL" ? leads : leads.filter((l) => l.status === filter);

  return (
    <>
      <style>{css}</style>
      <div className="app">
        {/* ── TOPBAR ── */}
        <header className="topbar">
          <div className="logo">
            APEX<span>//</span>APPLY
          </div>
          <div className="topbar-right">
            <div
              className="live-dot"
              style={{
                background: agentRunning ? "var(--green)" : "var(--muted)",
              }}
            />
            <span className="live-label">
              {agentRunning ? "AGENT ACTIVE" : "STANDBY"}
            </span>
          </div>
        </header>

        {/* ── SIDEBAR ── */}
        <aside className="sidebar">
          {/* Resume upload */}
          <div>
            <div className="section-label">Resume</div>
            <div
              className={`upload-zone ${profile ? "upload-loaded" : ""}`}
              onClick={() => fileRef.current?.click()}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".pdf"
                onChange={(e) => handleUpload(e.target.files[0])}
              />
              <div className="upload-icon">
                {uploading ? "⏳" : profile ? "✅" : "📄"}
              </div>
              <div className="upload-text">
                {uploading
                  ? "Parsing..."
                  : profile
                    ? `${profile.name}`
                    : "Drop PDF or click to upload"}
              </div>
            </div>
          </div>

          {/* Profile fields */}
          {profile && (
            <div>
              <div className="section-label">Profile</div>
              <div className="field-group">
                <div className="field">
                  <label>Email</label>
                  <input
                    id="f-email"
                    defaultValue={profile.email}
                    placeholder="your@email.com"
                  />
                </div>
                <div className="field-row">
                  <div className="field">
                    <label>Phone</label>
                    <input
                      id="f-phone"
                      defaultValue={profile.phone}
                      placeholder="+91..."
                    />
                  </div>
                  <div className="field">
                    <label>Location</label>
                    <input
                      id="f-loc"
                      defaultValue={
                        profile.location?.toLowerCase().includes("city")
                          ? ""
                          : profile.location
                      }
                      placeholder="Remote"
                    />
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

                {/* ── URL fields — saved once, used on every application ── */}
                <div className="field">
                  <label>LinkedIn URL</label>
                  <input
                    id="f-linkedin"
                    defaultValue={profile.linkedinUrl || ""}
                    placeholder="https://linkedin.com/in/..."
                  />
                </div>
                <div className="field">
                  <label>GitHub URL</label>
                  <input
                    id="f-github"
                    defaultValue={profile.githubUrl || ""}
                    placeholder="https://github.com/..."
                  />
                </div>
                <div className="field">
                  <label>Portfolio / Website</label>
                  <input
                    id="f-portfolio"
                    defaultValue={profile.portfolioUrl || ""}
                    placeholder="https://yoursite.com"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Target roles */}
          {profile?.titles?.length > 0 && (
            <div>
              <div className="section-label">AI Target Roles</div>
              <div className="roles-box">
                {profile.titles.map((t, i) => (
                  <span key={i} className="role-tag">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="divider" />

          {/* Deploy */}
          <div>
            <div className="section-label">Deploy Engine</div>
            <div className="deploy-grid">
              {[
                ["Google", "🔍"],
                ["LinkedIn", "💼"],
                ["Naukri", "🇮🇳"],
              ].map(([p, icon]) => (
                <button
                  key={p}
                  className="btn-deploy"
                  onClick={() => deployAgent(p)}
                  disabled={agentRunning || !profile}
                >
                  <span>
                    {icon} {p}
                  </span>
                  <span className="arrow">›</span>
                </button>
              ))}

              {/* Stop button — shown while running */}
              {agentRunning && (
                <button className="btn-stop" onClick={stopAgent}>
                  ⏹ STOP AGENT
                </button>
              )}

              {/* Resume button — shown after stopping, picks up where it left off */}
              {!agentRunning && lastPlatform && (
                <button
                  className="btn-deploy"
                  onClick={() => deployAgent(lastPlatform)}
                  disabled={!profile}
                  style={{ borderColor: "var(--green)", color: "var(--green)" }}
                >
                  <span>▶ Resume {lastPlatform}</span>
                  <span className="arrow">›</span>
                </button>
              )}
            </div>
          </div>
        </aside>

        {/* ── MAIN ── */}
        <main className="main">
          {/* Stats */}
          <div className="stats-row">
            {[
              {
                val: fmt(total),
                lbl: "Total Found",
                sub: "all leads",
                color: "var(--text)",
              },
              {
                val: fmt(applied),
                lbl: "Applied",
                sub: "submitted",
                color: "var(--green)",
              },
              {
                val: fmt(pending),
                lbl: "Pending",
                sub: "queued",
                color: "var(--blue)",
              },
              {
                val: fmt(manual),
                lbl: "Manual Review",
                sub: "needs attention",
                color: "#f97316",
              },
              {
                val: fmt(failed),
                lbl: "Failed",
                sub: "blocked/failed",
                color: "var(--red)",
              },
              {
                val: `${rate}%`,
                lbl: "Apply Rate",
                sub: "success ratio",
                color: "var(--gold)",
              },
            ].map((s) => (
              <div className="stat-card" key={s.lbl}>
                <div className="stat-val" style={{ color: s.color }}>
                  {s.val}
                </div>
                <div className="stat-lbl">{s.lbl}</div>
                <div className="stat-sub">{s.sub}</div>
              </div>
            ))}
          </div>

          {agentRunning && (
            <div className="agent-running-bar">
              <span className="spinner">◌</span>
              Agent is running — leads update every 8 seconds automatically
            </div>
          )}

          {/* Filters */}
          <div className="filters">
            {FILTERS.map((f) => (
              <button
                key={f}
                className={`filter-btn ${filter === f ? "active" : ""}`}
                onClick={() => setFilter(f)}
              >
                {f.replace(/_/g, " ")}
                {f !== "ALL" && (
                  <span style={{ marginLeft: 5, opacity: 0.7 }}>
                    {leads.filter((l) => l.status === f).length}
                  </span>
                )}
              </button>
            ))}
            <div className="filters-right">
              <button className="btn-sm" onClick={fetchLeads}>
                ↻ Refresh
              </button>
              <button className="btn-sm danger" onClick={nukeLeads}>
                ✕ Nuke All
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="table-wrap">
            {filtered.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">◎</div>
                <div>
                  {filter === "ALL"
                    ? "No leads yet. Deploy an engine to start."
                    : `No leads with status "${filter}"`}
                </div>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Company & Role</th>
                    <th>Status</th>
                    <th>Direct Link</th>
                    <th>Found</th>
                    <th>Applied</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((lead) => {
                    const meta =
                      STATUS_META[lead.status] || STATUS_META.DISCOVERED;
                    return (
                      <tr key={lead._id}>
                        <td>
                          <div className="company-cell">
                            <span className="company-name">{lead.company}</span>
                            <span className="job-title">{lead.jobTitle}</span>
                          </div>
                        </td>
                        <td>
                          <span
                            className="status-badge"
                            style={{ color: meta.color, background: meta.bg }}
                          >
                            {meta.label}
                          </span>
                        </td>
                        <td>
                          <a
                            className="link-btn"
                            href={lead.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open ↗
                          </a>
                        </td>
                        <td className="date-cell">{timeAgo(lead.createdAt)}</td>
                        <td className="date-cell">
                          {lead.status === "APPLIED"
                            ? timeAgo(lead.updatedAt)
                            : "—"}
                        </td>
                        <td>
                          <button
                            className="action-btn"
                            onClick={() => deleteLead(lead._id)}
                            title="Remove"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Terminal */}
          <div className="terminal">
            <div className="terminal-header">
              <div className="term-dot" style={{ background: "#ff4560" }} />
              <div className="term-dot" style={{ background: "#f5a623" }} />
              <div className="term-dot" style={{ background: "#00e57a" }} />
              <span className="term-title" style={{ marginLeft: 8 }}>
                AGENT LOG
              </span>
            </div>
            <div className="terminal-body" ref={logRef}>
              {logs.map((l, i) => (
                <div key={i} className={`log-line ${l.type || ""}`}>
                  {l.ts && <span className="ts">[{l.ts}]</span>}
                  {l.text}
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
