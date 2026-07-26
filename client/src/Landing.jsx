import { useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// client/src/Landing.jsx
//
// Public, no-login page. Browsing this never touches a database — it's
// pure static/illustrative content so a new visitor can see what Apex Apply
// does before handing over an email address. Real usage (uploading an
// actual resume, running the agent, seeing real leads) still requires an
// account — see App.js, which only renders this page until the user clicks
// through to Login.
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  bg: "#F7F8FA",
  panel: "#FFFFFF",
  panel2: "#F3F4F6",
  border: "#E5E7EB",
  gold: "#4F46E5",
  gold2: "#6366F1",
  green: "#16A34A",
  text: "#111827",
  muted: "#6B7280",
  muted2: "#9CA3AF",
};

// Kept the variable name "mono" to avoid touching the ~12 places that spread
// it below — repointed to the regular sans font, since small-caps eyebrow
// labels read as clean/SaaS in a plain font and as "terminal" in monospace.
const mono = { fontFamily: "'Inter', sans-serif" };

function StepBadge({ n, active }) {
  return (
    <div
      style={{
        width: 26,
        height: 26,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 12,
        fontWeight: 700,
        flexShrink: 0,
        background: active ? C.gold : C.panel2,
        color: active ? "#000" : C.muted,
        border: `1px solid ${active ? C.gold : C.border}`,
        ...mono,
      }}
    >
      {n}
    </div>
  );
}

function SampleField({ label, value }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div
        style={{
          ...mono,
          fontSize: 9,
          letterSpacing: ".08em",
          color: C.muted2,
          textTransform: "uppercase",
          marginBottom: 3,
        }}
      >
        {label}
      </div>
      <div
        style={{
          background: C.bg,
          border: `1px solid ${C.border}`,
          borderRadius: 5,
          padding: "7px 10px",
          fontSize: 12,
          color: C.text,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>{value}</span>
        <span style={{ color: C.green, fontSize: 11 }}>✓</span>
      </div>
    </div>
  );
}

export default function Landing({ onGetStarted, onLogin }) {
  const [step, setStep] = useState(1);

  return (
    <div
      style={{
        background: C.bg,
        color: C.text,
        minHeight: "100vh",
        fontFamily: "'Inter', sans-serif",
      }}
    >
      {/* ── Top bar ───────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "16px 28px",
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <div style={{ fontWeight: 800, letterSpacing: ".1em", fontSize: 14 }}>
          APEX <span style={{ color: C.gold }}>APPLY</span>
        </div>
        <button
          onClick={onLogin}
          style={{
            background: "transparent",
            border: `1px solid ${C.border}`,
            color: C.muted,
            borderRadius: 6,
            padding: "6px 14px",
            fontSize: 11,
            ...mono,
            cursor: "pointer",
          }}
        >
          Sign In
        </button>
      </div>

      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <div
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: "64px 24px 40px",
          textAlign: "center",
        }}
      >
        <h1
          style={{
            fontSize: 34,
            fontWeight: 800,
            lineHeight: 1.25,
            marginBottom: 16,
          }}
        >
          Stop retyping your resume
          <br />
          into every job application.
        </h1>
        <p
          style={{
            color: C.muted,
            fontSize: 15,
            lineHeight: 1.6,
            maxWidth: 520,
            margin: "0 auto 28px",
          }}
        >
          Upload your resume once. Apex reads it, finds matching roles, and
          fills out the application form for you — name, experience, "why do you
          want this job," all of it. You review it and click Submit yourself.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <button
            onClick={onGetStarted}
            style={{
              background: C.gold,
              color: "#000",
              border: "none",
              borderRadius: 6,
              padding: "11px 22px",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Get Started — Free
          </button>
          <button
            onClick={onLogin}
            style={{
              background: "transparent",
              color: C.muted,
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              padding: "11px 22px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            I already have an account
          </button>
        </div>
      </div>

      {/* ── Feature strip ─────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: 28,
          flexWrap: "wrap",
          padding: "0 24px 56px",
          ...mono,
          fontSize: 11,
          color: C.muted,
        }}
      >
        <span>📄 Reads your resume</span>
        <span>🔍 Finds matching roles</span>
        <span>✍️ Fills out the form</span>
        <span>👤 You click submit</span>
      </div>

      {/* ── Why Apex, not just any autofiller ───────────────────────────── */}
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "0 24px 56px" }}>
        <div style={{ textAlign: "center", marginBottom: 22 }}>
          <span
            style={{
              ...mono,
              fontSize: 10,
              letterSpacing: ".12em",
              color: C.gold,
              textTransform: "uppercase",
            }}
          >
            Verified, not just filled
          </span>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 14,
          }}
        >
          {[
            {
              h: "Most autofill tools guess once",
              p: "Type into a field, move on, hope it's right. If it mapped your phone number into the wrong box, you find out after you've submitted.",
            },
            {
              h: "Apex checks its own work",
              p: "Every field gets read back and compared against what was meant to go there before it's ever shown to you for review.",
            },
            {
              h: "You see clean or flagged — never silent",
              p: "If something doesn't verify cleanly, it's flagged for you to look at. You never review a form Apex isn't confident about without knowing it.",
            },
          ].map((c) => (
            <div
              key={c.h}
              style={{
                background: C.panel,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                padding: 16,
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 12.5,
                  marginBottom: 6,
                  lineHeight: 1.3,
                }}
              >
                {c.h}
              </div>
              <div style={{ color: C.muted, fontSize: 11.5, lineHeight: 1.5 }}>
                {c.p}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Sample walkthrough ────────────────────────────────────────── */}
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 24px 72px" }}>
        <div style={{ textAlign: "center", marginBottom: 6 }}>
          <span
            style={{
              ...mono,
              fontSize: 10,
              letterSpacing: ".12em",
              color: C.gold,
              textTransform: "uppercase",
            }}
          >
            Sample walkthrough
          </span>
        </div>
        <p
          style={{
            textAlign: "center",
            color: C.muted2,
            fontSize: 12,
            marginBottom: 28,
            ...mono,
          }}
        >
          Illustrative example with made-up data — not a real applicant or job
          posting.
        </p>

        {/* Step selector */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 12,
            marginBottom: 24,
          }}
        >
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                cursor: "pointer",
              }}
              onClick={() => setStep(n)}
            >
              <StepBadge n={n} active={step === n} />
            </div>
          ))}
        </div>

        <div
          style={{
            background: C.panel,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            padding: 28,
            minHeight: 280,
          }}
        >
          {step === 1 && (
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
                1. Upload your resume
              </div>
              <div style={{ color: C.muted, fontSize: 12, marginBottom: 18 }}>
                Apex reads it and builds a profile — no manual data entry.
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 16,
                }}
              >
                <SampleField label="Name" value="Jordan Lee (sample)" />
                <SampleField label="Location" value="Bengaluru, India" />
                <SampleField label="Email" value="jordan.lee@example.com" />
                <SampleField label="Phone" value="+91 98xxxxxx21" />
              </div>
              <div style={{ marginTop: 6 }}>
                <div
                  style={{
                    ...mono,
                    fontSize: 9,
                    letterSpacing: ".08em",
                    color: C.muted2,
                    textTransform: "uppercase",
                    marginBottom: 6,
                  }}
                >
                  Suggested roles
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {[
                    "Frontend Engineer",
                    "Full-Stack Developer",
                    "React Developer",
                  ].map((r) => (
                    <span
                      key={r}
                      style={{
                        background: "rgba(79,70,229,.08)",
                        border: "1px solid rgba(79,70,229,.2)",
                        color: C.gold2,
                        fontSize: 10,
                        padding: "3px 9px",
                        borderRadius: 4,
                        ...mono,
                      }}
                    >
                      {r}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
                2. Apex fills out the application
              </div>
              <div style={{ color: C.muted, fontSize: 12, marginBottom: 18 }}>
                Field-by-field, matched against the job description — like a
                Greenhouse form.
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 16,
                }}
              >
                <SampleField label="Full Name" value="Jordan Lee" />
                <SampleField label="Email" value="jordan.lee@example.com" />
              </div>
              <SampleField
                label="Why do you want to work here?"
                value="“I'd love to bring my React + TypeScript background to your team's…”"
              />
              <div
                style={{ ...mono, fontSize: 10, color: C.muted2, marginTop: 4 }}
              >
                ⚡ 9/11 fields filled automatically · 2 left for you to glance
                at
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
                3. You review, then you hit submit
              </div>
              <div style={{ color: C.muted, fontSize: 12, marginBottom: 18 }}>
                Apex never clicks Submit for you. It hands the filled form back
                to you to check.
              </div>
              <div
                style={{
                  background: C.bg,
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  padding: 20,
                  textAlign: "center",
                }}
              >
                <div style={{ color: C.muted, fontSize: 12, marginBottom: 14 }}>
                  All fields verified ✓ — ready when you are
                </div>
                <div
                  style={{
                    display: "inline-block",
                    background: C.gold,
                    color: "#000",
                    fontWeight: 700,
                    fontSize: 12,
                    padding: "9px 24px",
                    borderRadius: 6,
                  }}
                >
                  Submit Application
                </div>
                <div
                  style={{
                    ...mono,
                    fontSize: 9,
                    color: C.muted2,
                    marginTop: 10,
                  }}
                >
                  ↑ your click, not ours
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Closing CTA ───────────────────────────────────────────────── */}
      <div style={{ textAlign: "center", padding: "0 24px 80px" }}>
        <button
          onClick={onGetStarted}
          style={{
            background: C.gold,
            color: "#000",
            border: "none",
            borderRadius: 6,
            padding: "12px 28px",
            fontSize: 14,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Try it with your resume →
        </button>
      </div>

      <div
        style={{
          textAlign: "center",
          padding: "20px 0 28px",
          borderTop: `1px solid ${C.border}`,
          color: C.muted2,
          fontSize: 11,
          ...mono,
        }}
      >
        Apex Apply — built by a solo developer in Indore, India.
      </div>
    </div>
  );
}
