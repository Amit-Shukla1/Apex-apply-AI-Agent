import { useState } from "react";

const SERVER = "http://localhost:5000";

export default function Login({
  onAuthenticated,
  initialMode = "login",
  onBack,
}) {
  const [mode, setMode] = useState(initialMode); // "login" | "register"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const endpoint = mode === "login" ? "/api/login" : "/api/register";
      const r = await fetch(`${SERVER}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error || "Something went wrong");
        setLoading(false);
        return;
      }
      onAuthenticated(data.user);
    } catch (err) {
      setError("Could not reach the server");
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#F7F8FA",
        fontFamily: "Inter, sans-serif",
      }}
    >
      <form
        onSubmit={submit}
        style={{
          width: 360,
          padding: 36,
          background: "#FFFFFF",
          border: "1px solid #E5E7EB",
          borderRadius: 14,
          boxShadow: "0 4px 16px rgba(17,24,39,0.06)",
        }}
      >
        {onBack && (
          <div
            onClick={onBack}
            style={{
              color: "#9CA3AF",
              fontSize: 12,
              marginBottom: 16,
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            ← Back
          </div>
        )}
        <div
          style={{
            color: "#111827",
            fontWeight: 800,
            fontSize: 19,
            letterSpacing: "-.01em",
            marginBottom: 26,
            textAlign: "center",
          }}
        >
          Apex <span style={{ color: "#4F46E5" }}>Apply</span>
        </div>

        <div
          style={{
            display: "flex",
            marginBottom: 22,
            gap: 4,
            background: "#F3F4F6",
            borderRadius: 8,
            padding: 3,
          }}
        >
          <button
            type="button"
            onClick={() => setMode("login")}
            style={{
              flex: 1,
              padding: "8px",
              background: mode === "login" ? "#FFFFFF" : "transparent",
              color: mode === "login" ? "#111827" : "#6B7280",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
              boxShadow:
                mode === "login" ? "0 1px 2px rgba(17,24,39,0.08)" : "none",
            }}
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => setMode("register")}
            style={{
              flex: 1,
              padding: "8px",
              background: mode === "register" ? "#FFFFFF" : "transparent",
              color: mode === "register" ? "#111827" : "#6B7280",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
              boxShadow:
                mode === "register" ? "0 1px 2px rgba(17,24,39,0.08)" : "none",
            }}
          >
            Register
          </button>
        </div>

        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={{
            width: "100%",
            padding: "11px 13px",
            marginBottom: 10,
            background: "#FFFFFF",
            border: "1px solid #D1D5DB",
            borderRadius: 8,
            color: "#111827",
            fontSize: 14,
            fontFamily: "inherit",
            boxSizing: "border-box",
            outline: "none",
          }}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          style={{
            width: "100%",
            padding: "11px 13px",
            marginBottom: 18,
            background: "#FFFFFF",
            border: "1px solid #D1D5DB",
            borderRadius: 8,
            color: "#111827",
            fontSize: 14,
            fontFamily: "inherit",
            boxSizing: "border-box",
            outline: "none",
          }}
        />

        {error && (
          <div
            style={{
              color: "#DC2626",
              fontSize: 13,
              marginBottom: 14,
              background: "#FEF2F2",
              padding: "8px 10px",
              borderRadius: 6,
            }}
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%",
            padding: "11px",
            background: "#4F46E5",
            color: "#FFFFFF",
            border: "none",
            borderRadius: 8,
            fontWeight: 600,
            cursor: loading ? "default" : "pointer",
            opacity: loading ? 0.6 : 1,
            fontSize: 14,
          }}
        >
          {loading ? "..." : mode === "login" ? "Log in" : "Create account"}
        </button>
      </form>
    </div>
  );
}
