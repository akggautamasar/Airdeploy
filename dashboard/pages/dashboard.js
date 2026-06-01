import { useState, useEffect } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";

const API = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL || "";
const SECRET = process.env.NEXT_PUBLIC_ORCHESTRATOR_SECRET || "";

async function apiFetch(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Secret": SECRET,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }
  return res.json();
}

const STATUS_COLORS = {
  alive: "#22c55e",
  deploying: "#f59e0b",
  suspended: "#f97316",
  error: "#ef4444",
};

function StatusBadge({ status }) {
  return (
    <span
      style={{
        background: STATUS_COLORS[status] + "22",
        color: STATUS_COLORS[status] || "#aaa",
        padding: "0.25rem 0.75rem",
        borderRadius: "2rem",
        fontSize: "0.78rem",
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        border: `1px solid ${STATUS_COLORS[status] || "#aaa"}44`,
      }}
    >
      {status}
    </span>
  );
}

function DeploymentCard({ deployment, onRedeploy, onDelete }) {
  const [loading, setLoading] = useState(null);

  const handleRedeploy = async () => {
    setLoading("redeploy");
    try {
      await onRedeploy(deployment.app_name);
    } finally {
      setLoading(null);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete ${deployment.app_name}? This cannot be undone.`)) return;
    setLoading("delete");
    try {
      await onDelete(deployment.app_name);
    } finally {
      setLoading(null);
    }
  };

  const deployedDate = deployment.deployed_at
    ? new Date(deployment.deployed_at).toLocaleDateString()
    : "—";

  return (
    <div style={styles.card}>
      <div style={styles.cardHeader}>
        <div>
          <h3 style={styles.appName}>{deployment.app_name}</h3>
          <a
            href={`https://${deployment.subdomain}`}
            target="_blank"
            rel="noopener noreferrer"
            style={styles.subdomain}
          >
            {deployment.subdomain} ↗
          </a>
        </div>
        <StatusBadge status={deployment.status} />
      </div>

      <div style={styles.meta}>
        <span style={styles.metaItem}>🔧 {deployment.runtime}</span>
        <span style={styles.metaItem}>📅 {deployedDate}</span>
        {deployment.last_ping && (
          <span style={styles.metaItem}>
            🏓 {new Date(deployment.last_ping).toLocaleTimeString()}
          </span>
        )}
      </div>

      <div style={styles.cardActions}>
        <button
          onClick={handleRedeploy}
          disabled={!!loading}
          style={{ ...styles.btn, ...styles.btnSecondary }}
        >
          {loading === "redeploy" ? "..." : "🔄 Redeploy"}
        </button>
        <Link
          href={`/logs/${deployment.app_name}`}
          style={{ ...styles.btn, ...styles.btnSecondary, textDecoration: "none" }}
        >
          📋 Logs
        </Link>
        <button
          onClick={handleDelete}
          disabled={!!loading}
          style={{ ...styles.btn, ...styles.btnDanger }}
        >
          {loading === "delete" ? "..." : "🗑 Delete"}
        </button>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const router = useRouter();
  const owner = router.query.owner || (typeof window !== "undefined" ? localStorage.getItem("airdeploy_owner") || "" : "");

  const [deployments, setDeployments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [ownerInput, setOwnerInput] = useState(owner);

  const fetchDeployments = async (ownerName) => {
    if (!ownerName) return;
    setLoading(true);
    setError(null);
    try {
      const all = await apiFetch("/deployments");
      setDeployments(all.filter((d) => d.owner === ownerName));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (owner) {
      setOwnerInput(owner);
      fetchDeployments(owner);
    } else {
      setLoading(false);
    }
  }, [owner]);

  const handleOwnerSubmit = (e) => {
    e.preventDefault();
    if (typeof window !== "undefined") localStorage.setItem("airdeploy_owner", ownerInput);
    router.push(`/dashboard?owner=${ownerInput}`);
  };

  const handleRedeploy = async (appName) => {
    try {
      await apiFetch(`/redeploy/${appName}`, {
        method: "POST",
        body: JSON.stringify({ owner }),
      });
      alert(`Redeploy triggered for ${appName}`);
    } catch (e) {
      alert(`Redeploy failed: ${e.message}`);
    }
  };

  const handleDelete = async (appName) => {
    try {
      await apiFetch(`/undeploy/${appName}`, {
        method: "DELETE",
        body: JSON.stringify({ owner }),
      });
      setDeployments((prev) => prev.filter((d) => d.app_name !== appName));
    } catch (e) {
      alert(`Delete failed: ${e.message}`);
    }
  };

  return (
    <>
      <Head>
        <title>Dashboard — AirDeploy</title>
      </Head>
      <div style={styles.page}>
        <nav style={styles.nav}>
          <Link href="/" style={styles.logo}>⚡ AirDeploy</Link>
          <Link href="/deploy" style={styles.ctaBtn}>+ New Deployment</Link>
        </nav>

        <main style={styles.main}>
          <div style={styles.header}>
            <h1 style={styles.title}>Your Deployments</h1>

            {!owner && (
              <form onSubmit={handleOwnerSubmit} style={styles.ownerForm}>
                <input
                  type="text"
                  placeholder="Enter your username to see deployments"
                  value={ownerInput}
                  onChange={(e) => setOwnerInput(e.target.value)}
                  style={styles.input}
                  required
                />
                <button type="submit" style={styles.submitBtn}>View</button>
              </form>
            )}

            {owner && (
              <p style={styles.subtitle}>
                Showing deployments for <strong>{owner}</strong>
              </p>
            )}
          </div>

          {loading && <div style={styles.message}>Loading deployments...</div>}
          {error && <div style={styles.error}>Error: {error}</div>}

          {!loading && !error && owner && deployments.length === 0 && (
            <div style={styles.empty}>
              <p style={{ color: "#6b7280", fontSize: "1.1rem" }}>No deployments yet.</p>
              <Link href="/deploy" style={styles.ctaBtn}>Deploy your first app →</Link>
            </div>
          )}

          <div style={styles.grid}>
            {deployments.map((d) => (
              <DeploymentCard
                key={d.app_name}
                deployment={d}
                onRedeploy={handleRedeploy}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </main>
      </div>
    </>
  );
}

const styles = {
  page: { background: "#0a0a0a", color: "#fff", minHeight: "100vh", fontFamily: "system-ui, -apple-system, sans-serif" },
  nav: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 2rem", borderBottom: "1px solid #1f1f1f" },
  logo: { fontWeight: 700, fontSize: "1.25rem", color: "#fff", textDecoration: "none" },
  ctaBtn: { background: "#6366f1", color: "#fff", padding: "0.5rem 1.25rem", borderRadius: "0.5rem", textDecoration: "none", fontWeight: 600, fontSize: "0.9rem" },
  main: { maxWidth: "1100px", margin: "0 auto", padding: "2rem" },
  header: { marginBottom: "2rem" },
  title: { fontSize: "2rem", fontWeight: 700, margin: "0 0 0.5rem", letterSpacing: "-0.02em" },
  subtitle: { color: "#9ca3af", margin: 0 },
  ownerForm: { display: "flex", gap: "0.75rem", marginTop: "1rem", maxWidth: "480px" },
  input: { flex: 1, background: "#111", border: "1px solid #2d2d2d", borderRadius: "0.5rem", padding: "0.65rem 1rem", color: "#fff", fontSize: "0.95rem", outline: "none" },
  submitBtn: { background: "#6366f1", color: "#fff", border: "none", borderRadius: "0.5rem", padding: "0.65rem 1.25rem", cursor: "pointer", fontWeight: 600 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "1.5rem" },
  card: { background: "#111", border: "1px solid #1f1f1f", borderRadius: "1rem", padding: "1.5rem" },
  cardHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" },
  appName: { margin: "0 0 0.35rem", fontSize: "1.15rem", fontWeight: 700 },
  subdomain: { color: "#818cf8", fontSize: "0.85rem", textDecoration: "none" },
  meta: { display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1.25rem" },
  metaItem: { color: "#6b7280", fontSize: "0.82rem" },
  cardActions: { display: "flex", gap: "0.75rem", flexWrap: "wrap" },
  btn: { padding: "0.5rem 1rem", borderRadius: "0.5rem", border: "none", cursor: "pointer", fontSize: "0.85rem", fontWeight: 600 },
  btnSecondary: { background: "#1f1f1f", color: "#d1d5db" },
  btnDanger: { background: "#2d1515", color: "#ef4444" },
  message: { color: "#9ca3af", textAlign: "center", padding: "3rem" },
  error: { background: "#1a0f0f", border: "1px solid #3d1515", borderRadius: "0.75rem", padding: "1rem 1.5rem", color: "#ef4444", marginBottom: "1.5rem" },
  empty: { textAlign: "center", padding: "4rem 2rem" },
};
