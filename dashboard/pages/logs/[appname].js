import { useState, useEffect, useRef } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";

const API = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL || "";
const SECRET = process.env.NEXT_PUBLIC_ORCHESTRATOR_SECRET || "";

export default function Logs() {
  const router = useRouter();
  const { appname } = router.query;
  const [logs, setLogs] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastFetched, setLastFetched] = useState(null);
  const logRef = useRef(null);

  const fetchLogs = async () => {
    if (!appname) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${API}/logs/${appname}`, {
        headers: { "X-Secret": SECRET },
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(err.detail || resp.statusText);
      }
      const data = await resp.json();
      setLogs(data.logs || "(no logs)");
      setLastFetched(new Date().toLocaleTimeString());
      setTimeout(() => logRef.current?.scrollTo(0, logRef.current.scrollHeight), 50);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!appname) return;
    fetchLogs();
    const interval = setInterval(fetchLogs, 30000);
    return () => clearInterval(interval);
  }, [appname]);

  return (
    <>
      <Head>
        <title>{appname ? `Logs: ${appname}` : "Logs"} — AirDeploy</title>
      </Head>
      <div style={styles.page}>
        <nav style={styles.nav}>
          <Link href="/" style={styles.logo}>⚡ AirDeploy</Link>
          <Link href="/dashboard" style={styles.navLink}>← Dashboard</Link>
        </nav>

        <main style={styles.main}>
          <div style={styles.header}>
            <div>
              <h1 style={styles.title}>
                Logs
                {appname && <span style={styles.appBadge}>{appname}</span>}
              </h1>
              {lastFetched && (
                <p style={styles.fetchedAt}>
                  Last fetched: {lastFetched} · Auto-refreshes every 30s
                </p>
              )}
            </div>
            <button
              onClick={fetchLogs}
              disabled={loading}
              style={styles.refreshBtn}
            >
              {loading ? "⏳" : "🔄"} Refresh
            </button>
          </div>

          {error && <div style={styles.errorBox}>{error}</div>}

          <div style={styles.terminal} ref={logRef}>
            {loading && !logs ? (
              <span style={styles.loadingText}>Fetching logs...</span>
            ) : (
              <pre style={styles.pre}>{logs || "(no logs available)"}</pre>
            )}
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
  navLink: { color: "#9ca3af", textDecoration: "none", fontSize: "0.9rem" },
  main: { maxWidth: "900px", margin: "0 auto", padding: "2rem" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem", flexWrap: "wrap", gap: "1rem" },
  title: { fontSize: "1.75rem", fontWeight: 700, margin: 0, letterSpacing: "-0.02em", display: "flex", alignItems: "center", gap: "0.75rem" },
  appBadge: { background: "#1a1a2e", color: "#818cf8", padding: "0.25rem 0.75rem", borderRadius: "0.4rem", fontSize: "1rem", border: "1px solid #3730a3", fontFamily: "monospace" },
  fetchedAt: { color: "#6b7280", fontSize: "0.8rem", margin: "0.35rem 0 0" },
  refreshBtn: { background: "#1f1f1f", border: "1px solid #2d2d2d", color: "#d1d5db", padding: "0.5rem 1rem", borderRadius: "0.5rem", cursor: "pointer", fontWeight: 600, fontSize: "0.9rem" },
  errorBox: { background: "#1a0f0f", border: "1px solid #3d1515", borderRadius: "0.75rem", padding: "1rem 1.5rem", color: "#ef4444", marginBottom: "1.5rem" },
  terminal: { background: "#060606", border: "1px solid #1a1a1a", borderRadius: "0.75rem", padding: "1.5rem", minHeight: "500px", maxHeight: "70vh", overflowY: "auto", fontFamily: "monospace" },
  pre: { margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all", color: "#a3e635", fontSize: "0.82rem", lineHeight: 1.75 },
  loadingText: { color: "#6b7280", fontSize: "0.85rem" },
};
