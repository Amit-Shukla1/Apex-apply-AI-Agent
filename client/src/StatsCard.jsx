import { useEffect, useRef, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// client/src/StatsCard.jsx
//
// A shareable "field report" card built from the user's own real numbers —
// no fabricated stats, no fake social proof. If interviews/responses are 0
// because the person hasn't logged any yet, the card just doesn't claim them.
//
// Drawn directly to a <canvas> so the on-screen preview and the downloaded
// PNG can never drift out of sync — one drawing routine, one source of truth.
// ─────────────────────────────────────────────────────────────────────────────

const W = 1200;
const H = 675;

const C = {
  bg: "#FFFFFF",
  bg2: "#F7F8FA",
  border: "#E5E7EB",
  gold: "#4F46E5",
  gold2: "#6366F1",
  text: "#111827",
  muted: "#6B7280",
  muted2: "#9CA3AF",
  green: "#16A34A",
};

function buildCaption({ total, applied, responded, interviews, daysActive }) {
  const lines = [
    `Day ${daysActive} with Apex Apply:`,
    `🔍 ${total} matching role${total === 1 ? "" : "s"} found`,
    `✍️ ${applied} application${applied === 1 ? "" : "s"} filled & verified`,
  ];
  if (responded > 0)
    lines.push(`📨 ${responded} repl${responded === 1 ? "y" : "ies"}`);
  if (interviews > 0)
    lines.push(
      `🎉 ${interviews} interview${interviews === 1 ? "" : "s"} booked`,
    );
  lines.push("", "Verified before you click — not just filled. #JobSearch");
  return lines.join("\n");
}

async function ensureFonts() {
  try {
    await Promise.all([
      document.fonts.load("800 64px Inter"),
      document.fonts.load("700 22px Inter"),
      document.fonts.load("600 16px Inter"),
      document.fonts.load("500 16px Inter"),
      document.fonts.load("400 16px Inter"),
    ]);
    await document.fonts.ready;
  } catch {
    /* fall back to default fonts silently — not worth blocking on */
  }
}

function draw(ctx, stats) {
  const { total, applied, responded, interviews, daysActive } = stats;

  // ── Background ──────────────────────────────────────────────────────────
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, C.bg);
  grad.addColorStop(1, C.bg2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.textBaseline = "alphabetic";

  // ── Wordmark ─────────────────────────────────────────────────────────────
  ctx.fillStyle = C.text;
  ctx.font = "800 26px Inter, sans-serif";
  ctx.fillText("APEX", 64, 76);
  const apexW = ctx.measureText("APEX").width;
  ctx.fillStyle = C.gold;
  ctx.fillText(" // APPLY", 64 + apexW, 76);

  // ── "Field report" eyebrow line ─────────────────────────────────────────
  ctx.font = "600 15px Inter, sans-serif";
  ctx.fillStyle = C.muted;
  ctx.fillText(`FIELD REPORT — DAY ${daysActive}`, 64, 112);

  // ── Verified stamp (signature element, top-right) ───────────────────────
  ctx.save();
  ctx.translate(W - 118, 90);
  ctx.rotate(-0.18);
  ctx.beginPath();
  ctx.setLineDash([4, 5]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = C.gold;
  ctx.arc(0, 0, 52, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = C.gold;
  ctx.font = "700 13px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("VERIFIED", 0, -2);
  ctx.font = "16px sans-serif";
  ctx.fillText("✓", 0, 18);
  ctx.textAlign = "left";
  ctx.restore();

  // ── Headline number — pick the most impressive real stat ───────────────
  let headlineVal = total;
  let headlineLbl = "ROLES FOUND";
  if (interviews > 0) {
    headlineVal = interviews;
    headlineLbl = interviews === 1 ? "INTERVIEW BOOKED" : "INTERVIEWS BOOKED";
  } else if (applied > 0) {
    headlineVal = applied;
    headlineLbl = applied === 1 ? "APPLICATION FILED" : "APPLICATIONS FILED";
  }

  ctx.fillStyle = C.gold;
  ctx.font = "800 168px Inter, sans-serif";
  ctx.fillText(String(headlineVal), 60, 330);
  ctx.fillStyle = C.muted;
  ctx.font = "700 20px Inter, sans-serif";
  ctx.fillText(headlineLbl, 66, 362);

  // ── Divider ──────────────────────────────────────────────────────────────
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(64, 400);
  ctx.lineTo(W - 64, 400);
  ctx.stroke();

  // ── Log lines ────────────────────────────────────────────────────────────
  const logLines = [
    { n: total, label: `role${total === 1 ? "" : "s"} found`, color: C.text },
    {
      n: applied,
      label: `application${applied === 1 ? "" : "s"} filled & verified`,
      color: C.green,
    },
  ];
  if (responded > 0)
    logLines.push({
      n: responded,
      label: `repl${responded === 1 ? "y" : "ies"} received`,
      color: C.gold2,
    });
  if (interviews > 0)
    logLines.push({
      n: interviews,
      label: `interview${interviews === 1 ? "" : "s"} booked`,
      color: C.gold,
    });

  let logY = 440;
  for (const line of logLines) {
    ctx.font = "500 17px Inter, sans-serif";
    ctx.fillStyle = C.muted2;
    ctx.fillText("•", 64, logY);
    ctx.fillStyle = line.color;
    ctx.font = "700 17px Inter, sans-serif";
    const numTxt = `${line.n}`;
    ctx.fillText(numTxt, 84, logY);
    const numW = ctx.measureText(numTxt).width;
    ctx.fillStyle = C.muted;
    ctx.font = "400 17px Inter, sans-serif";
    ctx.fillText(` ${line.label}`, 84 + numW, logY);
    logY += 34;
  }

  // ── Footer ───────────────────────────────────────────────────────────────
  ctx.font = "400 13px Inter, sans-serif";
  ctx.fillStyle = C.muted2;
  ctx.fillText(
    "Apex Apply — stop retyping your resume into every application.",
    64,
    H - 36,
  );
}

export default function StatsCard({ stats, onClose }) {
  const canvasRef = useRef(null);
  const [copied, setCopied] = useState(false);
  const caption = buildCaption(stats);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await ensureFonts();
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      draw(ctx, stats);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    stats.total,
    stats.applied,
    stats.responded,
    stats.interviews,
    stats.daysActive,
  ]);

  const downloadImage = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "apex-apply-stats.png";
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  };

  const copyCaption = async () => {
    try {
      await navigator.clipboard.writeText(caption);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard permission denied — caption is still visible to copy manually */
    }
  };

  const shareOnX = () => {
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(caption)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.75)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#FFFFFF",
          border: "1px solid #E5E7EB",
          borderRadius: 14,
          padding: 24,
          maxWidth: 680,
          width: "100%",
          maxHeight: "92vh",
          overflowY: "auto",
          boxShadow: "0 8px 32px rgba(17,24,39,0.18)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <div
            style={{
              color: "#111827",
              fontWeight: 700,
              fontSize: 15,
              fontFamily: "Inter, sans-serif",
            }}
          >
            Share your stats
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#9CA3AF",
              fontSize: 18,
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>

        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          style={{
            width: "100%",
            borderRadius: 10,
            border: "1px solid #E5E7EB",
            display: "block",
          }}
        />

        <div
          style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}
        >
          <button onClick={downloadImage} style={btnStyle(true)}>
            ⬇ Download image
          </button>
          <button onClick={copyCaption} style={btnStyle(false)}>
            {copied ? "✓ Copied" : "📋 Copy caption"}
          </button>
          <button onClick={shareOnX} style={btnStyle(false)}>
            Share on X
          </button>
        </div>

        <div
          style={{
            marginTop: 14,
            fontSize: 12,
            color: "#6B7280",
            fontFamily: "Inter, sans-serif",
            lineHeight: 1.6,
          }}
        >
          X opens with your caption pre-filled — attach the downloaded image
          before posting.
          <br />
          LinkedIn doesn't support pre-filled posts, so download the image, copy
          the caption, then paste both into a new LinkedIn post yourself.
        </div>

        <div
          style={{
            marginTop: 14,
            background: "#F7F8FA",
            border: "1px solid #E5E7EB",
            borderRadius: 8,
            padding: 10,
            fontSize: 12,
            color: "#374151",
            fontFamily: "Inter, sans-serif",
            whiteSpace: "pre-wrap",
          }}
        >
          {caption}
        </div>
      </div>
    </div>
  );
}

function btnStyle(primary) {
  return {
    background: primary ? "#4F46E5" : "transparent",
    color: primary ? "#FFFFFF" : "#4F46E5",
    border: primary ? "none" : "1px solid #4F46E5",
    borderRadius: 7,
    padding: "9px 16px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "Inter, sans-serif",
  };
}
