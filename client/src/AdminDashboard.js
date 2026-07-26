import { useState, useEffect } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

const SERVER = "http://localhost:5000";
const apiFetch = (url, opts = {}) =>
  fetch(url, { ...opts, credentials: "include" });

const COLORS = {
  gold: "#4F46E5",
  green: "#16A34A",
  blue: "#2563EB",
  orange: "#D97706",
  red: "#DC2626",
  muted: "#6B7280",
};
const STATUS_COLORS = {
  APPLIED: COLORS.green,
  DISCOVERED: COLORS.blue,
  ANALYZING_FORM: COLORS.blue,
  APPLYING: COLORS.blue,
  MANUAL_REVIEW_NEEDED: COLORS.orange,
  FAILED: COLORS.red,
  FAILED_NEEDS_HEALING: COLORS.red,
  CAPTCHA_BLOCKED: COLORS.red,
  RESPONDED: COLORS.gold,
};
const PLATFORM_COLORS = {
  Greenhouse: COLORS.gold,
  Lever: COLORS.blue,
  Other: COLORS.muted,
};

const StatCard = ({ label, value, color }) => (
  <div
    style={{
      background: "#FFFFFF",
      border: "1px solid #E5E7EB",
      borderRadius: 10,
      padding: "16px 18px",
      flex: 1,
      minWidth: 130,
      boxShadow: "0 1px 2px rgba(17,24,39,0.04)",
    }}
  >
    <div style={{ fontSize: 22, fontWeight: 700, color: color || "#111827" }}>
      {value}
    </div>
    <div
      style={{
        fontSize: 11,
        color: "#9CA3AF",
        marginTop: 4,
        textTransform: "uppercase",
        letterSpacing: ".05em",
        fontWeight: 600,
      }}
    >
      {label}
    </div>
  </div>
);

const Panel = ({ title, children }) => (
  <div
    style={{
      background: "#FFFFFF",
      border: "1px solid #E5E7EB",
      borderRadius: 10,
      padding: 18,
      flex: 1,
      minWidth: 320,
      boxShadow: "0 1px 2px rgba(17,24,39,0.04)",
    }}
  >
    <div
      style={{
        fontSize: 12,
        color: "#6B7280",
        marginBottom: 12,
        letterSpacing: ".05em",
        textTransform: "uppercase",
        fontWeight: 600,
      }}
    >
      {title}
    </div>
    {children}
  </div>
);

export default function AdminDashboard({ onBack }) {
  const [overview, setOverview] = useState(null);
  const [users, setUsers] = useState([]);
  const [timeseries, setTimeseries] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [togglingId, setTogglingId] = useState(null);

  const togglePro = async (userId, nextIsPro) => {
    setTogglingId(userId);
    try {
      const r = await apiFetch(`${SERVER}/api/admin/users/${userId}/pro`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPro: nextIsPro }),
      });
      const d = await r.json();
      if (r.ok) {
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, isPro: nextIsPro } : u)),
        );
      } else {
        alert(d.error || "Failed to update pro status");
      }
    } catch (e) {
      alert(`Error: ${e.message}`);
    } finally {
      setTogglingId(null);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const [oRes, uRes, tRes] = await Promise.all([
          apiFetch(`${SERVER}/api/admin/overview`),
          apiFetch(`${SERVER}/api/admin/users`),
          apiFetch(`${SERVER}/api/admin/timeseries`),
        ]);
        if (!oRes.ok || !uRes.ok || !tRes.ok) {
          setError(
            "Failed to load admin data — are you sure this account is an admin?",
          );
          setLoading(false);
          return;
        }
        setOverview(await oRes.json());
        setUsers((await uRes.json()).users);
        setTimeseries(await tRes.json());
      } catch (e) {
        setError(e.message);
      }
      setLoading(false);
    })();
  }, []);

  if (loading) {
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
        Loading dashboard...
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          height: "100vh",
          background: "#F7F8FA",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          color: "#DC2626",
          fontFamily: "Inter, sans-serif",
          fontSize: 14,
        }}
      >
        {error}
        <button
          onClick={onBack}
          style={{
            background: "#4F46E5",
            color: "#FFFFFF",
            border: "none",
            padding: "9px 18px",
            borderRadius: 8,
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          ← Back
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#F7F8FA",
        color: "#111827",
        fontFamily: "Inter, sans-serif",
        padding: 24,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 24,
        }}
      >
        <div
          style={{
            fontSize: 17,
            fontWeight: 800,
            color: "#4F46E5",
            letterSpacing: "-.01em",
          }}
        >
          ⚙ Admin Dashboard
        </div>
        <button
          onClick={onBack}
          style={{
            background: "#FFFFFF",
            border: "1px solid #D1D5DB",
            color: "#374151",
            padding: "7px 16px",
            borderRadius: 7,
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          ← Back to app
        </button>
      </div>

      {/* Stat cards */}
      <div
        style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}
      >
        <StatCard label="Total Users" value={overview.totalUsers} />
        <StatCard
          label="New This Week"
          value={overview.newUsersThisWeek}
          color={COLORS.gold}
        />
        <StatCard label="Total Leads" value={overview.totalLeads} />
        <StatCard
          label="Applied"
          value={overview.totalApplied}
          color={COLORS.green}
        />
        <StatCard
          label="Apply Rate"
          value={`${overview.applyRate}%`}
          color={COLORS.gold}
        />
        <StatCard
          label="Manual Review"
          value={overview.totalManualReview}
          color={COLORS.orange}
        />
        <StatCard
          label="Failed"
          value={overview.totalFailed}
          color={COLORS.red}
        />
        <StatCard
          label="Registry Entries"
          value={overview.totalRegistryEntries}
        />
      </div>

      {/* Charts row 1: signups + applications over time */}
      <div
        style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}
      >
        <Panel title="New Signups — Last 30 Days">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={timeseries.signups}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 9, fill: "#9CA3AF" }}
                tickFormatter={(d) => d.slice(5)}
              />
              <YAxis
                tick={{ fontSize: 9, fill: "#9CA3AF" }}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  background: "#FFFFFF",
                  border: "1px solid #E5E7EB",
                  fontSize: 12,
                  borderRadius: 8,
                  boxShadow: "0 2px 8px rgba(17,24,39,0.08)",
                }}
              />
              <Line
                type="monotone"
                dataKey="count"
                stroke={COLORS.gold}
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Applications Submitted — Last 30 Days">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={timeseries.applications}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 9, fill: "#9CA3AF" }}
                tickFormatter={(d) => d.slice(5)}
              />
              <YAxis
                tick={{ fontSize: 9, fill: "#9CA3AF" }}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  background: "#FFFFFF",
                  border: "1px solid #E5E7EB",
                  fontSize: 12,
                  borderRadius: 8,
                  boxShadow: "0 2px 8px rgba(17,24,39,0.08)",
                }}
              />
              <Line
                type="monotone"
                dataKey="count"
                stroke={COLORS.green}
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      {/* Charts row 2: status + platform breakdown */}
      <div
        style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}
      >
        <Panel title="Leads by Status">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={overview.statusBreakdown}
              layout="vertical"
              margin={{ left: 40 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis
                type="number"
                tick={{ fontSize: 9, fill: "#9CA3AF" }}
                allowDecimals={false}
              />
              <YAxis
                dataKey="status"
                type="category"
                tick={{ fontSize: 9, fill: "#9CA3AF" }}
                width={130}
              />
              <Tooltip
                contentStyle={{
                  background: "#FFFFFF",
                  border: "1px solid #E5E7EB",
                  fontSize: 12,
                  borderRadius: 8,
                  boxShadow: "0 2px 8px rgba(17,24,39,0.08)",
                }}
              />
              <Bar dataKey="count" radius={[0, 3, 3, 0]}>
                {overview.statusBreakdown.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={STATUS_COLORS[entry.status] || COLORS.muted}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Leads by Platform">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={overview.platformBreakdown}
                dataKey="count"
                nameKey="platform"
                cx="50%"
                cy="50%"
                outerRadius={75}
                label={({ platform, count }) => `${platform}: ${count}`}
                labelLine={false}
              >
                {overview.platformBreakdown.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={PLATFORM_COLORS[entry.platform] || COLORS.muted}
                  />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: "#FFFFFF",
                  border: "1px solid #E5E7EB",
                  fontSize: 12,
                  borderRadius: 8,
                  boxShadow: "0 2px 8px rgba(17,24,39,0.08)",
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      {/* Users table */}
      <Panel title={`Users (${users.length})`}>
        <div style={{ overflowX: "auto" }}>
          <table
            style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}
          >
            <thead>
              <tr
                style={{
                  borderBottom: "1px solid #E5E7EB",
                  color: "#6B7280",
                  textAlign: "left",
                }}
              >
                <th style={{ padding: "8px 6px" }}>Email</th>
                <th style={{ padding: "8px 6px" }}>Name</th>
                <th style={{ padding: "8px 6px" }}>Signed up</th>
                <th style={{ padding: "8px 6px" }}>Resume</th>
                <th style={{ padding: "8px 6px", textAlign: "right" }}>
                  Leads
                </th>
                <th style={{ padding: "8px 6px", textAlign: "right" }}>
                  Applied
                </th>
                <th style={{ padding: "8px 6px", textAlign: "right" }}>
                  Apply %
                </th>
                <th style={{ padding: "8px 6px", textAlign: "right" }}>
                  Review
                </th>
                <th style={{ padding: "8px 6px", textAlign: "right" }}>
                  Failed
                </th>
                <th style={{ padding: "8px 6px" }}>Role</th>
                <th style={{ padding: "8px 6px" }}>Plan</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                  <td style={{ padding: "8px 6px" }}>{u.email}</td>
                  <td style={{ padding: "8px 6px", color: "#6B7280" }}>
                    {u.profileName || "—"}
                  </td>
                  <td style={{ padding: "8px 6px", color: "#6B7280" }}>
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                  <td style={{ padding: "8px 6px" }}>
                    {u.hasResume ? "✅" : "—"}
                  </td>
                  <td style={{ padding: "8px 6px", textAlign: "right" }}>
                    {u.leadCount}
                  </td>
                  <td
                    style={{
                      padding: "8px 6px",
                      textAlign: "right",
                      color: COLORS.green,
                    }}
                  >
                    {u.appliedCount}
                  </td>
                  <td
                    style={{
                      padding: "8px 6px",
                      textAlign: "right",
                      color: COLORS.gold,
                    }}
                  >
                    {u.applyRate}%
                  </td>
                  <td
                    style={{
                      padding: "8px 6px",
                      textAlign: "right",
                      color: COLORS.orange,
                    }}
                  >
                    {u.manualCount}
                  </td>
                  <td
                    style={{
                      padding: "8px 6px",
                      textAlign: "right",
                      color: COLORS.red,
                    }}
                  >
                    {u.failedCount}
                  </td>
                  <td style={{ padding: "8px 6px" }}>
                    {u.isAdmin ? (
                      <span style={{ color: COLORS.gold }}>Admin</span>
                    ) : (
                      "User"
                    )}
                  </td>
                  <td style={{ padding: "8px 6px" }}>
                    <button
                      onClick={() => togglePro(u.id, !u.isPro)}
                      disabled={togglingId === u.id}
                      style={{
                        fontSize: 11,
                        padding: "4px 10px",
                        borderRadius: 4,
                        cursor: togglingId === u.id ? "wait" : "pointer",
                        border: u.isPro
                          ? `1px solid ${COLORS.gold}`
                          : "1px solid #D1D5DB",
                        background: u.isPro
                          ? "rgba(79,70,229,.1)"
                          : "transparent",
                        color: u.isPro ? COLORS.gold : "#9CA3AF",
                        fontFamily: "Inter, sans-serif",
                      }}
                    >
                      {togglingId === u.id ? "..." : u.isPro ? "★ Pro" : "Free"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
