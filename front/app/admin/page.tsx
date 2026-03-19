"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Doc = { id: string; title: string; filename: string; createdAt: string };
type User = { id: string; email: string; name?: string; role: "ADMIN" | "USER" };

type EvaluationSummary = {
  windowDays: number;
  overview: {
    totalTurns: number;
    successRate: number;
    avgTurnLatencyMs: number;
    p50TurnLatencyMs: number;
    p95TurnLatencyMs: number;
    avgRetrievalMs: number;
    avgGenerationMs: number;
    fusionUsageRate: number;
    fallbackRate: number;
    avgVariantCount: number;
    avgCitationCount: number;
  };
  series: {
    dailyTurns: Array<{ date: string; turns: number; successRate: number }>;
    dailyLatency: Array<{ date: string; avgLatencyMs: number; p95LatencyMs: number }>;
    modeBreakdown: Array<{ label: string; value: number }>;
    recentTurns: Array<{
      timestamp: string;
      latencyMs: number;
      retrievalMs: number;
      generationMs: number;
      citationCount: number;
      mode: "fusion" | "single";
      fallback: boolean;
      success: boolean;
    }>;
  };
};

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:5000";

export default function AdminPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [docTitle, setDocTitle] = useState("");
  const [docFile, setDocFile] = useState<File | null>(null);
  const [userEmail, setUserEmail] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [userName, setUserName] = useState("");
  const [userRole, setUserRole] = useState<"ADMIN" | "USER">("USER");
  const [message, setMessage] = useState("");
  const [evalSummary, setEvalSummary] = useState<EvaluationSummary | null>(null);
  const [evalDays, setEvalDays] = useState(7);
  const [evalLoading, setEvalLoading] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("admin_token");
    if (!stored) {
      router.push("/login");
      return;
    }

    setToken(stored);
  }, [router]);

  useEffect(() => {
    if (!token) return;
    void refreshAll(token);
  }, [token]);

  async function refreshAll(authToken: string) {
    try {
      const [docsRes, usersRes] = await Promise.all([
        fetch(`${BACKEND_URL}/documents`, {
          headers: { Authorization: `Bearer ${authToken}` },
        }),
        fetch(`${BACKEND_URL}/users`, {
          headers: { Authorization: `Bearer ${authToken}` },
        }),
      ]);

      if (docsRes.ok) {
        setDocs(await docsRes.json());
      }

      if (usersRes.ok) {
        setUsers(await usersRes.json());
      }

      await refreshEvaluation(authToken, evalDays);
    } catch {
      setMessage("Failed to fetch admin data");
    }
  }

  async function refreshEvaluation(authToken: string, days: number) {
    setEvalLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/evaluation/summary?days=${days}&limit=10000`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      if (!res.ok) {
        setMessage("Failed to load evaluation metrics");
        return;
      }

      const summary = (await res.json()) as EvaluationSummary;
      setEvalSummary(summary);
    } finally {
      setEvalLoading(false);
    }
  }

  async function uploadDocument(e: FormEvent) {
    e.preventDefault();
    if (!token || !docFile) return;

    const form = new FormData();
    form.append("file", docFile);
    if (docTitle.trim()) form.append("title", docTitle.trim());

    const res = await fetch(`${BACKEND_URL}/documents/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });

    if (!res.ok) {
      setMessage("Document upload failed");
      return;
    }

    setMessage("Document uploaded");
    setDocTitle("");
    setDocFile(null);
    await refreshAll(token);
  }

  async function deleteDocument(id: string) {
    if (!token) return;

    const res = await fetch(`${BACKEND_URL}/documents/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      setMessage("Failed to delete document");
      return;
    }

    setMessage("Document deleted");
    await refreshAll(token);
  }

  async function createUser(e: FormEvent) {
    e.preventDefault();
    if (!token) return;

    const res = await fetch(`${BACKEND_URL}/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        email: userEmail,
        password: userPassword,
        name: userName || undefined,
        role: userRole,
      }),
    });

    if (!res.ok) {
      setMessage("Failed to create user");
      return;
    }

    setMessage("User created");
    setUserEmail("");
    setUserPassword("");
    setUserName("");
    setUserRole("USER");
    await refreshAll(token);
  }

  async function deleteUser(id: string) {
    if (!token) return;

    const res = await fetch(`${BACKEND_URL}/users/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      setMessage("Failed to delete user");
      return;
    }

    setMessage("User deleted");
    await refreshAll(token);
  }

  function logout() {
    localStorage.removeItem("admin_token");
    localStorage.removeItem("admin_user");
    router.push("/login");
  }

  const trendDailyTurns = evalSummary?.series.dailyTurns ?? [];
  const trendDailyLatency = evalSummary?.series.dailyLatency ?? [];
  const modeBreakdown = evalSummary?.series.modeBreakdown ?? [];
  const recentTurns = evalSummary?.series.recentTurns ?? [];

  const kpis = evalSummary
    ? [
        { label: "Total Turns", value: formatNumber(evalSummary.overview.totalTurns), tone: "neutral" },
        { label: "Success Rate", value: `${evalSummary.overview.successRate.toFixed(1)}%`, tone: "good" },
        { label: "P95 Latency", value: `${evalSummary.overview.p95TurnLatencyMs.toFixed(0)} ms`, tone: "warn" },
        { label: "Fusion Usage", value: `${evalSummary.overview.fusionUsageRate.toFixed(1)}%`, tone: "info" },
        { label: "Fallback Rate", value: `${evalSummary.overview.fallbackRate.toFixed(1)}%`, tone: "bad" },
        { label: "Avg Variants", value: evalSummary.overview.avgVariantCount.toFixed(2), tone: "info" },
      ]
    : [];

  return (
    <div className="admin-shell">
      <header className="admin-header">
        <div>
          <h1>Admin Panel</h1>
          <p>Manage documents, users, and live RAG evaluation</p>
        </div>
        <div className="admin-actions">
          <a href="/chat">Open chat</a>
          <button onClick={logout}>Logout</button>
        </div>
      </header>

      {message ? <div className="flash-msg">{message}</div> : null}

      <section className="card eval-card">
        <div className="eval-header">
          <div>
            <h2>Evaluation Dashboard</h2>
            <p>Online metrics from real-time turn logs</p>
          </div>
          <div className="eval-controls">
            <label>
              Window
              <select
                value={evalDays}
                onChange={(e) => {
                  const days = Number(e.target.value);
                  setEvalDays(days);
                  if (token) {
                    void refreshEvaluation(token, days);
                  }
                }}
              >
                <option value={1}>1 day</option>
                <option value={7}>7 days</option>
                <option value={14}>14 days</option>
                <option value={30}>30 days</option>
              </select>
            </label>
            <button onClick={() => token && void refreshEvaluation(token, evalDays)} disabled={evalLoading}>
              {evalLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="kpi-grid">
          {kpis.map((kpi) => (
            <div className={`kpi ${kpi.tone}`} key={kpi.label}>
              <span>{kpi.label}</span>
              <strong>{kpi.value}</strong>
            </div>
          ))}
          {kpis.length === 0 ? <p>No evaluation data yet. Send some chat traffic first.</p> : null}
        </div>

        <div className="eval-chart-grid">
          <article className="chart-card">
            <h3>Daily Turn Volume</h3>
            <SimpleBarChart
              data={trendDailyTurns.map((point) => ({
                label: point.date.slice(5),
                value: point.turns,
              }))}
            />
          </article>

          <article className="chart-card">
            <h3>Daily Latency Trend</h3>
            <SimpleLineChart
              data={trendDailyLatency.map((point) => ({
                label: point.date.slice(5),
                value: point.avgLatencyMs,
                secondary: point.p95LatencyMs,
              }))}
              primaryLabel="Avg"
              secondaryLabel="P95"
            />
          </article>

          <article className="chart-card">
            <h3>Retrieval Mode Split</h3>
            <DonutChart data={modeBreakdown} />
          </article>

          <article className="chart-card">
            <h3>Recent Turn Latency</h3>
            <SimpleLineChart
              data={recentTurns.map((point, index) => ({
                label: String(index + 1),
                value: point.latencyMs,
                secondary: point.retrievalMs,
              }))}
              primaryLabel="Turn"
              secondaryLabel="Retrieval"
            />
          </article>
        </div>
      </section>

      <section className="admin-grid">
        <article className="card">
          <h2>Upload Document</h2>
          <form onSubmit={uploadDocument} className="stack-form">
            <input
              value={docTitle}
              onChange={(e) => setDocTitle(e.target.value)}
              placeholder="Optional title"
            />
            <input
              type="file"
              onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
              required
            />
            <button type="submit">Upload and ingest</button>
          </form>

          <h3>Documents</h3>
          <div className="table-box">
            {docs.map((doc) => (
              <div key={doc.id} className="row">
                <div>
                  <strong>{doc.title}</strong>
                  <small>{doc.filename}</small>
                </div>
                <button onClick={() => deleteDocument(doc.id)}>Delete</button>
              </div>
            ))}
            {docs.length === 0 ? <p>No documents</p> : null}
          </div>
        </article>

        <article className="card">
          <h2>Create User</h2>
          <form onSubmit={createUser} className="stack-form">
            <input value={userEmail} onChange={(e) => setUserEmail(e.target.value)} placeholder="Email" required />
            <input value={userPassword} onChange={(e) => setUserPassword(e.target.value)} placeholder="Password" type="password" required />
            <input value={userName} onChange={(e) => setUserName(e.target.value)} placeholder="Name (optional)" />
            <select value={userRole} onChange={(e) => setUserRole(e.target.value as "ADMIN" | "USER")}> 
              <option value="USER">USER</option>
              <option value="ADMIN">ADMIN</option>
            </select>
            <button type="submit">Create user</button>
          </form>

          <h3>Users</h3>
          <div className="table-box">
            {users.map((user) => (
              <div key={user.id} className="row">
                <div>
                  <strong>{user.email}</strong>
                  <small>{user.role}{user.name ? ` | ${user.name}` : ""}</small>
                </div>
                <button onClick={() => deleteUser(user.id)}>Delete</button>
              </div>
            ))}
            {users.length === 0 ? <p>No users</p> : null}
          </div>
        </article>
      </section>
    </div>
  );
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}

function SimpleBarChart({ data }: { data: Array<{ label: string; value: number }> }) {
  const max = Math.max(1, ...data.map((point) => point.value));

  return (
    <div className="simple-bar-chart">
      {data.length === 0 ? <p>No data</p> : null}
      {data.map((point) => (
        <div key={`${point.label}-${point.value}`} className="bar-row">
          <span>{point.label}</span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(point.value / max) * 100}%` }} />
          </div>
          <strong>{point.value}</strong>
        </div>
      ))}
    </div>
  );
}

function SimpleLineChart({
  data,
  primaryLabel,
  secondaryLabel,
}: {
  data: Array<{ label: string; value: number; secondary?: number }>;
  primaryLabel: string;
  secondaryLabel: string;
}) {
  if (!data.length) {
    return <p>No data</p>;
  }

  const width = 520;
  const height = 210;
  const padding = 24;

  const max = Math.max(
    1,
    ...data.map((point) => point.value),
    ...data.map((point) => point.secondary ?? 0),
  );

  const toPoint = (value: number, index: number) => {
    const x = padding + (index * (width - padding * 2)) / Math.max(1, data.length - 1);
    const y = height - padding - (value / max) * (height - padding * 2);
    return `${x},${y}`;
  };

  const primaryPath = data.map((point, index) => toPoint(point.value, index)).join(" ");
  const secondaryPath = data
    .filter((point) => typeof point.secondary === "number")
    .map((point, index) => toPoint(point.secondary ?? 0, index))
    .join(" ");

  return (
    <div className="line-chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="line-chart" role="img" aria-label="line chart">
        <polyline points={primaryPath} className="line-primary" />
        {secondaryPath ? <polyline points={secondaryPath} className="line-secondary" /> : null}
      </svg>
      <div className="line-legend">
        <span className="legend-primary">{primaryLabel}</span>
        <span className="legend-secondary">{secondaryLabel}</span>
      </div>
    </div>
  );
}

function DonutChart({ data }: { data: Array<{ label: string; value: number }> }) {
  const total = data.reduce((acc, item) => acc + item.value, 0);
  if (!total) {
    return <p>No data</p>;
  }

  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const colors = ["#1f7a5d", "#3f5e92", "#9a3f38"];

  let offset = 0;

  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 120 120" className="donut-chart" role="img" aria-label="mode breakdown">
        <circle cx="60" cy="60" r={radius} className="donut-base" />
        {data.map((item, index) => {
          const segment = (item.value / total) * circumference;
          const strokeDasharray = `${segment} ${circumference - segment}`;
          const strokeDashoffset = -offset;
          offset += segment;

          return (
            <circle
              key={item.label}
              cx="60"
              cy="60"
              r={radius}
              className="donut-segment"
              style={{ stroke: colors[index % colors.length], strokeDasharray, strokeDashoffset }}
            />
          );
        })}
      </svg>
      <div className="donut-legend">
        {data.map((item, index) => (
          <div key={item.label}>
            <span style={{ background: colors[index % colors.length] }} />
            <strong>{item.label}</strong>
            <small>{((item.value / total) * 100).toFixed(1)}%</small>
          </div>
        ))}
      </div>
    </div>
  );
}
