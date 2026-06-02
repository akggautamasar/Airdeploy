import { useState, useEffect, useCallback } from "react";
import Head from "next/head";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL || "";
const SECRET = process.env.NEXT_PUBLIC_ORCHESTRATOR_SECRET || "";

async function apiFetch(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", "X-Secret": SECRET, ...(options.headers || {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }
  return res.json();
}

const FREE_HOURS = 750;
const MAX_SERVICES = parseInt(process.env.NEXT_PUBLIC_MAX_SERVICES_PER_ACCOUNT || "5");

function hoursColor(pct) {
  if (pct >= 95) return "#ef4444";
  if (pct >= 80) return "#f97316";
  if (pct >= 60) return "#f59e0b";
  return "#22c55e";
}

function HoursBar({ used, total = FREE_HOURS }) {
  const pct = Math.min(100, (used / total) * 100);
  const color = hoursColor(pct);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.3rem" }}>
        <span style={{ fontSize: "0.78rem", color }}>
          ~{Math.round(used)} / {total} hrs
        </span>
        <span style={{ fontSize: "0.78rem", color: "#6b7280" }}>
          {Math.round(pct)}%
          {pct >= 95 && " ⚠️ Critical"}
          {pct >= 80 && pct < 95 && " ⚠️ High"}
        </span>
      </div>
      <div style={{ background: "#1f1f1f", borderRadius: "0.5rem", height: "6px", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, background: color, height: "100%", borderRadius: "0.5rem", transition: "width 0.5s" }} />
      </div>
    </div>
  );
}

function estimateHours(deployments) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  let total = 0;
  for (const d of deployments) {
    if (d.status === "suspended" && !d.fail_count) continue; // manually suspended, not running
    const startDate = d.deployed_at ? new Date(Math.max(new Date(d.deployed_at), monthStart)) : monthStart;
    const hrs = (now - startDate) / (1000 * 60 * 60);
    total += Math.max(0, hrs);
  }
  return total;
}

function daysUntilReset() {
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return Math.ceil((nextMonth - now) / (1000 * 60 * 60 * 24));
}

function AccountCard({ account, deployments, onDelete }) {
  const [deleting, setDeleting] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const estimatedHrs = estimateHours(deployments);
  const pct = Math.min(100, (estimatedHrs / FREE_HOURS) * 100);
  const color = hoursColor(pct);
  const daysLeft = daysUntilReset();
  const projectedHrs = estimatedHrs + (deployments.length * daysLeft * 24);
  const willExceed = projectedHrs > FREE_HOURS;

  const handleDelete = async () => {
    if (!confirm(`Remove account ${account.account_id}? Existing services on this account will NOT be deleted from Render.`)) return;
    setDeleting(true);
    try { await onDelete(account.account_id); }
    catch (e) { alert(e.message); setDeleting(false); }
  };

  const statusColor = account.status === "available" ? "#22c55e" : account.status === "full" ? "#f59e0b" : "#ef4444";

  return (
    <div style={s.card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.25rem" }}>
            <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>{account.account_id}</span>
            <span style={{ background: statusColor + "22", color: statusColor, padding: "0.15rem 0.6rem", borderRadius: "2rem", fontSize: "0.7rem", fontWeight: 700, border: `1px solid ${statusColor}44` }}>
              {account.status}
            </span>
          </div>
          <span style={{ color: "#6b7280", fontSize: "0.78rem" }}>{account.email}</span>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "1.1rem", fontWeight: 700, color }}>
            {account.services_count} <span style={{ fontSize: "0.7rem", color: "#6b7280", fontWeight: 400 }}>/ {MAX_SERVICES} services</span>
          </div>
        </div>
      </div>

      <HoursBar used={estimatedHrs} />

      {willExceed && (
        <div style={{ marginTop: "0.65rem", background: "#1a0f0f", border: "1px solid #3d1515", borderRadius: "0.4rem", padding: "0.5rem 0.75rem", fontSize: "0.75rem", color: "#f97316" }}>
          ⚠️ Projected to exceed 750 hrs in {daysLeft} days — auto-migration will trigger
        </div>
      )}

      {deployments.length > 0 && (
        <div style={{ marginTop: "0.85rem" }}>
          <button onClick={() => setExpanded(v => !v)} style={s.expandBtn}>
            {expanded ? "▲" : "▼"} {deployments.length} service{deployments.length !== 1 ? "s" : ""}
          </button>
          {expanded && (
            <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              {deployments.map((d) => {
                const depHrs = Math.max(0, (new Date() - new Date(Math.max(new Date(d.deployed_at || 0), new Date(new Date().getFullYear(), new Date().getMonth(), 1)))) / (1000 * 60 * 60));
                const depColor = { alive: "#22c55e", deploying: "#f59e0b", suspended: "#6b7280", error: "#ef4444" }[d.status] || "#aaa";
                return (
                  <div key={d.app_name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#0d0d0d", borderRadius: "0.4rem", padding: "0.45rem 0.75rem" }}>
                    <div>
                      <Link href={`/app/${d.app_name}`} style={{ color: "#818cf8", textDecoration: "none", fontSize: "0.82rem", fontWeight: 600 }}>{d.app_name}</Link>
                      <span style={{ color: "#6b7280", fontSize: "0.72rem", marginLeft: "0.5rem" }}>{d.runtime}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                      <span style={{ color: "#6b7280", fontSize: "0.72rem" }}>~{Math.round(depHrs)} hrs</span>
                      <span style={{ color: depColor, fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase" }}>{d.status}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: "0.85rem", display: "flex", justifyContent: "flex-end" }}>
        <button onClick={handleDelete} disabled={deleting}
          style={{ ...s.btn, background: "transparent", color: "#6b7280", fontSize: "0.75rem", padding: "0.3rem 0.6rem", opacity: deleting ? 0.5 : 1 }}>
          {deleting ? "Removing…" : "Remove account"}
        </button>
      </div>
    </div>
  );
}

export default function Admin() {
  const [accounts, setAccounts] = useState([]);
  const [deployments, setDeployments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [addKey, setAddKey] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const [accs, deps] = await Promise.all([apiFetch("/accounts"), apiFetch("/deployments")]);
      setAccounts(accs);
      setDeployments(deps);
      setError(null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  const handleDelete = async (accountId) => {
    await apiFetch(`/accounts/${accountId}`, { method: "DELETE" });
    setAccounts((prev) => prev.filter((a) => a.account_id !== accountId));
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    setAdding(true);
    try {
      await apiFetch("/accounts", { method: "POST", body: JSON.stringify({ api_key: addKey, email: addEmail }) });
      setAddKey(""); setAddEmail("");
      await load();
    } catch (e) { alert(e.message); }
    finally { setAdding(false); }
  };

  // Global stats
  const totalServices = accounts.reduce((s, a) => s + (a.services_count || 0), 0);
  const availableAccounts = accounts.filter((a) => a.status === "available").length;
  const aliveServices = deployments.filter((d) => d.status === "alive").length;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const totalEstHrs = deployments.reduce((sum, d) => {
    const start = d.deployed_at ? new Date(Math.max(new Date(d.deployed_at), monthStart)) : monthStart;
    return sum + Math.max(0, (now - start) / (1000 * 60 * 60));
  }, 0);
  const criticalAccounts = accounts.filter((a) => {
    const deps = deployments.filter((d) => d.account_id === a.account_id);
    const hrs = estimateHours(deps);
    return (hrs / FREE_HOURS) >= 0.8;
  }).length;

  return (
    <>
      <Head><title>Admin — AirDeploy</title></Head>
      <div style={s.page}>
        <nav style={s.nav}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <Link href="/" style={s.logo}>⚡ AirDeploy</Link>
            <span style={{ color: "#2d2d2d" }}>/</span>
            <span style={{ color: "#d1d5db", fontSize: "0.88rem" }}>Admin</span>
          </div>
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <Link href="/dashboard" style={{ ...s.btn, ...s.btnSecondary, textDecoration: "none" }}>Dashboard</Link>
            <Link href="/deploy" style={s.ctaBtn}>+ New Deployment</Link>
          </div>
        </nav>

        <main style={s.main}>
          {error && <div style={s.errorBox}>Error: {error}</div>}

          {/* Global stats */}
          <div style={s.statsGrid}>
            {[
              { label: "Total Accounts", value: accounts.length, sub: `${availableAccounts} available` },
              { label: "Total Services", value: totalServices, sub: `${aliveServices} alive` },
              { label: "Est. Hours (month)", value: `~${Math.round(totalEstHrs)}`, sub: `${daysUntilReset()} days to reset` },
              { label: "Critical Accounts", value: criticalAccounts, sub: "> 80% hours used", color: criticalAccounts > 0 ? "#f97316" : "#22c55e" },
              { label: "Max Capacity", value: accounts.length * MAX_SERVICES, sub: `at ${MAX_SERVICES} services/account` },
              { label: "Safe Capacity", value: accounts.length, sub: "1 service/account" },
            ].map(({ label, value, sub, color }) => (
              <div key={label} style={s.statCard}>
                <div style={{ fontSize: "1.75rem", fontWeight: 700, color: color || "#fff", marginBottom: "0.25rem" }}>{value}</div>
                <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "#d1d5db", marginBottom: "0.15rem" }}>{label}</div>
                <div style={{ fontSize: "0.72rem", color: "#6b7280" }}>{sub}</div>
              </div>
            ))}
          </div>

          {/* Add account */}
          <div style={{ ...s.card, marginBottom: "1.5rem" }}>
            <h2 style={s.sectionTitle}>Add Render Account</h2>
            <form onSubmit={handleAdd} style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
              <input value={addKey} onChange={(e) => setAddKey(e.target.value)} required
                placeholder="rnd_xxxxxxxxxxxx (Render API key)"
                style={{ ...s.input, flex: 2, minWidth: "200px", fontFamily: "monospace" }} />
              <input value={addEmail} onChange={(e) => setAddEmail(e.target.value)} required
                placeholder="account@email.com"
                style={{ ...s.input, flex: 1, minWidth: "160px" }} />
              <button type="submit" disabled={adding}
                style={{ ...s.btn, ...s.btnPrimary, opacity: adding ? 0.6 : 1 }}>
                {adding ? "Adding…" : "+ Add Account"}
              </button>
            </form>
          </div>

          {/* Accounts list */}
          <h2 style={s.sectionTitle}>
            Accounts ({accounts.length})
            <span style={{ color: "#6b7280", fontWeight: 400, fontSize: "0.82rem", marginLeft: "0.75rem" }}>
              auto-refreshes every 30s
            </span>
          </h2>

          {loading && <div style={s.placeholder}>Loading…</div>}

          <div style={s.grid}>
            {accounts.map((acc) => (
              <AccountCard
                key={acc.account_id}
                account={acc}
                deployments={deployments.filter((d) => d.account_id === acc.account_id)}
                onDelete={handleDelete}
              />
            ))}
          </div>

          {!loading && accounts.length === 0 && (
            <div style={s.placeholder}>No accounts yet. Add one above.</div>
          )}
        </main>
      </div>
    </>
  );
}

const s = {
  page: { background: "#0a0a0a", color: "#fff", minHeight: "100vh", fontFamily: "system-ui, -apple-system, sans-serif" },
  nav: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 2rem", borderBottom: "1px solid #1a1a1a" },
  logo: { fontWeight: 700, fontSize: "1.2rem", color: "#fff", textDecoration: "none" },
  ctaBtn: { background: "#6366f1", color: "#fff", padding: "0.5rem 1.1rem", borderRadius: "0.5rem", textDecoration: "none", fontWeight: 600, fontSize: "0.85rem" },
  main: { maxWidth: "1200px", margin: "0 auto", padding: "2rem" },
  statsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: "1rem", marginBottom: "2rem" },
  statCard: { background: "#111", border: "1px solid #1f1f1f", borderRadius: "0.875rem", padding: "1.25rem" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: "1rem" },
  card: { background: "#111", border: "1px solid #1f1f1f", borderRadius: "0.875rem", padding: "1.25rem" },
  sectionTitle: { fontSize: "1rem", fontWeight: 700, margin: "0 0 1rem", color: "#d1d5db" },
  placeholder: { color: "#6b7280", textAlign: "center", padding: "3rem" },
  errorBox: { background: "#1a0f0f", border: "1px solid #3d1515", borderRadius: "0.6rem", padding: "0.9rem 1.25rem", color: "#ef4444", marginBottom: "1rem" },
  input: { background: "#0d0d0d", border: "1px solid #2d2d2d", borderRadius: "0.5rem", padding: "0.65rem 1rem", color: "#fff", fontSize: "0.88rem", outline: "none", boxSizing: "border-box" },
  btn: { padding: "0.5rem 1rem", borderRadius: "0.5rem", border: "none", cursor: "pointer", fontSize: "0.85rem", fontWeight: 600 },
  btnPrimary: { background: "#6366f1", color: "#fff" },
  btnSecondary: { background: "#1f1f1f", color: "#d1d5db" },
  expandBtn: { background: "none", border: "none", color: "#6b7280", cursor: "pointer", fontSize: "0.78rem", padding: "0.25rem 0", width: "100%", textAlign: "left" },
};
