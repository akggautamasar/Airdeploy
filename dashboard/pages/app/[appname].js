import { useState, useEffect, useRef, useCallback } from "react";
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
  const color = STATUS_COLORS[status] || "#aaa";
  return (
    <span style={{
      background: color + "22",
      color,
      padding: "0.3rem 0.85rem",
      borderRadius: "2rem",
      fontSize: "0.8rem",
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: "0.05em",
      border: `1px solid ${color}44`,
    }}>
      {status}
    </span>
  );
}

function TabBar({ active, tabs, onChange }) {
  return (
    <div style={s.tabBar}>
      {tabs.map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          style={{ ...s.tab, ...(active === t ? s.tabActive : {}) }}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

// ---- OVERVIEW TAB ----
function OverviewTab({ app, onRedeploy, redeploying }) {
  if (!app) return null;
  const rows = [
    ["Status", <StatusBadge key="s" status={app.status} />],
    ["Runtime", app.runtime],
    ["Branch", app.branch || "main"],
    ["Region", app.region || "oregon"],
    ["Deployed", app.deployed_at ? new Date(app.deployed_at).toLocaleString() : "—"],
    ["Last ping", app.last_ping ? new Date(app.last_ping).toLocaleString() : "—"],
    ["Fail count", app.fail_count ?? 0],
    ["Render URL", <a key="r" href={app.render_url} target="_blank" rel="noopener noreferrer" style={s.link}>{app.render_url} ↗</a>],
  ];

  return (
    <div>
      <div style={s.infoCard}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "1.4rem", fontWeight: 700 }}>{app.app_name}</h2>
            <a href={`https://${app.subdomain}`} target="_blank" rel="noopener noreferrer" style={{ ...s.link, fontSize: "0.9rem" }}>
              https://{app.subdomain} ↗
            </a>
          </div>
          <button
            onClick={onRedeploy}
            disabled={redeploying}
            style={{ ...s.btn, ...s.btnPrimary, opacity: redeploying ? 0.6 : 1 }}
          >
            {redeploying ? "Triggering..." : "🔄 Redeploy"}
          </button>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label} style={{ borderBottom: "1px solid #1f1f1f" }}>
                <td style={s.tdLabel}>{label}</td>
                <td style={s.tdValue}>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- LOGS TAB ----
function LogsTab({ appName }) {
  const [logs, setLogs] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const bottomRef = useRef(null);

  const fetchLogs = useCallback(async () => {
    try {
      setError(null);
      const data = await apiFetch(`/logs/${appName}`);
      setLogs(data.logs || "(no logs)");
      setLastRefresh(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [appName]);

  useEffect(() => {
    fetchLogs();
    const t = setInterval(fetchLogs, 30000);
    return () => clearInterval(t);
  }, [fetchLogs]);

  useEffect(() => {
    if (bottomRef.current) bottomRef.current.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <span style={{ color: "#6b7280", fontSize: "0.82rem" }}>
          {lastRefresh ? `Last refreshed: ${lastRefresh.toLocaleTimeString()} · auto-refreshes every 30s` : "Loading..."}
        </span>
        <button onClick={fetchLogs} style={{ ...s.btn, ...s.btnSecondary }}>↻ Refresh</button>
      </div>
      {error && <div style={s.errorBox}>{error}</div>}
      <pre style={s.terminal}>
        {loading ? "Fetching logs..." : (logs || "(no logs)")}
        <span ref={bottomRef} />
      </pre>
    </div>
  );
}

// ---- ENV VARS TAB ----
function EnvTab({ appName }) {
  const [envVars, setEnvVars] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    apiFetch(`/deployment/${appName}/env`)
      .then((data) => {
        const vars = (data.env_vars || []).map((e) => ({ key: e.key || "", value: e.value || "" }));
        setEnvVars(vars.length > 0 ? vars : [{ key: "", value: "" }]);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [appName]);

  const update = (i, field, val) => {
    setEnvVars((prev) => prev.map((row, idx) => (idx === i ? { ...row, [field]: val } : row)));
  };

  const addRow = () => setEnvVars((prev) => [...prev, { key: "", value: "" }]);
  const removeRow = (i) => setEnvVars((prev) => prev.filter((_, idx) => idx !== i));

  const save = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const env_vars = {};
      for (const { key, value } of envVars) {
        if (key.trim()) env_vars[key.trim()] = value;
      }
      await apiFetch(`/deployment/${appName}/env`, {
        method: "PUT",
        body: JSON.stringify({ env_vars }),
      });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={s.loadingText}>Loading environment variables...</div>;

  return (
    <div>
      <p style={{ color: "#9ca3af", fontSize: "0.85rem", marginBottom: "1rem" }}>
        Saving will update Render and trigger a redeploy.
      </p>
      {error && <div style={s.errorBox}>{error}</div>}
      {success && <div style={s.successBox}>Saved and redeploy triggered!</div>}
      <div style={s.envTable}>
        <div style={s.envHeader}>
          <span style={{ flex: 2 }}>Key</span>
          <span style={{ flex: 3 }}>Value</span>
          <span style={{ width: "2.5rem" }} />
        </div>
        {envVars.map((row, i) => (
          <div key={i} style={s.envRow}>
            <input
              value={row.key}
              onChange={(e) => update(i, "key", e.target.value)}
              placeholder="KEY"
              style={{ ...s.envInput, flex: 2, fontFamily: "monospace" }}
            />
            <input
              value={row.value}
              onChange={(e) => update(i, "value", e.target.value)}
              placeholder="value"
              style={{ ...s.envInput, flex: 3, fontFamily: "monospace" }}
            />
            <button onClick={() => removeRow(i)} style={s.removeBtn} title="Remove">✕</button>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
        <button onClick={addRow} style={{ ...s.btn, ...s.btnSecondary }}>+ Add Variable</button>
        <button onClick={save} disabled={saving} style={{ ...s.btn, ...s.btnPrimary, opacity: saving ? 0.6 : 1 }}>
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </div>
  );
}

// ---- SETTINGS TAB ----
function SettingsTab({ app, appName, onDelete }) {
  const [repoUrl, setRepoUrl] = useState(app?.repo_url || "");
  const [branch, setBranch] = useState(app?.branch || "main");
  const [rootDir, setRootDir] = useState(app?.root_dir || "");
  const [buildCmd, setBuildCmd] = useState(app?.build_command || "");
  const [startCmd, setStartCmd] = useState(app?.start_command || "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [dirs, setDirs] = useState([]);
  const [dirsLoading, setDirsLoading] = useState(false);

  const fetchDirs = async (url) => {
    if (!url || !url.includes("github.com")) return;
    setDirsLoading(true);
    try {
      const data = await apiFetch(`/repo-dirs?repo_url=${encodeURIComponent(url)}`);
      setDirs(data.dirs || []);
    } catch {
      setDirs([]);
    } finally {
      setDirsLoading(false);
    }
  };

  useEffect(() => {
    if (app?.repo_url) fetchDirs(app.repo_url);
  }, [app?.repo_url]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await apiFetch(`/deployment/${appName}/settings`, {
        method: "PUT",
        body: JSON.stringify({
          repo_url: repoUrl || undefined,
          branch: branch || undefined,
          root_dir: rootDir || undefined,
          build_command: buildCmd || undefined,
          start_command: startCmd || undefined,
        }),
      });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Permanently delete ${appName}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await onDelete();
    } catch (e) {
      setError(e.message);
      setDeleting(false);
    }
  };

  return (
    <div>
      {error && <div style={s.errorBox}>{error}</div>}
      {success && <div style={s.successBox}>Settings updated!</div>}
      <div style={s.settingsSection}>
        <h3 style={s.sectionTitle}>Build & Deploy</h3>
        <div style={s.field}>
          <label style={s.label}>Repository URL</label>
          <input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} style={s.input} placeholder="https://github.com/username/repo" />
        </div>
        <div style={s.field}>
          <label style={s.label}>Branch</label>
          <input value={branch} onChange={(e) => setBranch(e.target.value)} style={s.input} placeholder="main" />
        </div>
        <div style={s.field}>
          <label style={s.label}>
            Root Directory
            {dirsLoading && <span style={{ color: "#6b7280", fontWeight: 400, marginLeft: "0.5rem" }}>fetching…</span>}
          </label>
          {dirs.length > 0 ? (
            <select
              value={rootDir}
              onChange={(e) => setRootDir(e.target.value)}
              style={{ ...s.input, cursor: "pointer" }}
            >
              <option value="">/ (repo root)</option>
              {dirs.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
              <option value="__custom__">Custom path…</option>
            </select>
          ) : (
            <input value={rootDir} onChange={(e) => setRootDir(e.target.value)} style={s.input} placeholder="./ (repo root)" />
          )}
          {rootDir === "__custom__" && (
            <input
              autoFocus
              value=""
              onChange={(e) => setRootDir(e.target.value)}
              style={{ ...s.input, marginTop: "0.5rem" }}
              placeholder="e.g. backend"
            />
          )}
          <span style={{ color: "#6b7280", fontSize: "0.8rem" }}>Leave blank to use repo root</span>
        </div>
        <div style={s.field}>
          <label style={s.label}>Build Command</label>
          <input value={buildCmd} onChange={(e) => setBuildCmd(e.target.value)} style={s.input} placeholder="e.g. npm install" />
        </div>
        <div style={s.field}>
          <label style={s.label}>Start Command</label>
          <input value={startCmd} onChange={(e) => setStartCmd(e.target.value)} style={s.input} placeholder="e.g. npm start" />
        </div>
        <button onClick={save} disabled={saving} style={{ ...s.btn, ...s.btnPrimary, opacity: saving ? 0.6 : 1 }}>
          {saving ? "Saving..." : "Save Settings"}
        </button>
      </div>

      <div style={{ ...s.settingsSection, borderTop: "1px solid #2d1515", marginTop: "2rem", paddingTop: "1.5rem" }}>
        <h3 style={{ ...s.sectionTitle, color: "#ef4444" }}>Danger Zone</h3>
        <p style={{ color: "#9ca3af", fontSize: "0.85rem", marginBottom: "1rem" }}>
          Permanently delete this service and remove all associated resources.
        </p>
        <button
          onClick={handleDelete}
          disabled={deleting}
          style={{ ...s.btn, background: "#2d1515", color: "#ef4444", opacity: deleting ? 0.6 : 1 }}
        >
          {deleting ? "Deleting..." : "Delete Service"}
        </button>
      </div>
    </div>
  );
}

// ---- DEPLOYS TAB ----
function DeploysTab({ appName }) {
  const [deploys, setDeploys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    apiFetch(`/deployment/${appName}/deploys`)
      .then((data) => setDeploys(data.deploys || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [appName]);

  const statusColor = (s) => {
    if (s === "live") return "#22c55e";
    if (s === "build_failed" || s === "failed") return "#ef4444";
    if (s === "in_progress" || s === "building") return "#f59e0b";
    return "#6b7280";
  };

  if (loading) return <div style={s.loadingText}>Loading deploys...</div>;
  if (error) return <div style={s.errorBox}>{error}</div>;
  if (!deploys.length) return <div style={s.loadingText}>No deploy history.</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {deploys.map((d) => (
        <div key={d.id || d.commitId} style={s.deployRow}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>
              {d.commit?.message || d.commitId || "Deploy"}
            </span>
            <span style={{ color: statusColor(d.status), fontSize: "0.8rem", fontWeight: 700, textTransform: "uppercase" }}>
              {d.status}
            </span>
          </div>
          <div style={{ color: "#6b7280", fontSize: "0.8rem", marginTop: "0.3rem" }}>
            {d.finishedAt
              ? new Date(d.finishedAt).toLocaleString()
              : d.createdAt
              ? new Date(d.createdAt).toLocaleString()
              : ""}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- MAIN PAGE ----
const TABS = ["Overview", "Logs", "Deploys", "Environment", "Settings"];

export default function AppDetail() {
  const router = useRouter();
  const { appname } = router.query;
  const owner = typeof window !== "undefined" ? localStorage.getItem("airdeploy_owner") || "" : "";

  const [app, setApp] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("Overview");
  const [redeploying, setRedeploying] = useState(false);

  const fetchApp = useCallback(async () => {
    if (!appname) return;
    try {
      const data = await apiFetch(`/deployment/${appname}`);
      setApp(data);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [appname]);

  useEffect(() => {
    fetchApp();
    const t = setInterval(fetchApp, 15000);
    return () => clearInterval(t);
  }, [fetchApp]);

  const handleRedeploy = async () => {
    setRedeploying(true);
    try {
      await apiFetch(`/redeploy/${appname}`, {
        method: "POST",
        body: JSON.stringify({ owner }),
      });
    } catch (e) {
      alert(`Redeploy failed: ${e.message}`);
    } finally {
      setRedeploying(false);
    }
  };

  const handleDelete = async () => {
    await apiFetch(`/undeploy/${appname}`, {
      method: "DELETE",
      body: JSON.stringify({ owner }),
    });
    router.push("/dashboard" + (owner ? `?owner=${owner}` : ""));
  };

  return (
    <>
      <Head>
        <title>{appname || "App"} — AirDeploy</title>
      </Head>
      <div style={s.page}>
        <nav style={s.nav}>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <Link href="/" style={s.logo}>⚡ AirDeploy</Link>
            <span style={{ color: "#374151" }}>/</span>
            <Link href={`/dashboard${owner ? `?owner=${owner}` : ""}`} style={{ color: "#9ca3af", textDecoration: "none", fontSize: "0.9rem" }}>
              Dashboard
            </Link>
            <span style={{ color: "#374151" }}>/</span>
            <span style={{ color: "#d1d5db", fontSize: "0.9rem" }}>{appname}</span>
          </div>
          <Link href="/deploy" style={s.ctaBtn}>+ New Deployment</Link>
        </nav>

        <main style={s.main}>
          {loading && <div style={s.loadingText}>Loading...</div>}
          {error && !loading && <div style={s.errorBox}>Error: {error}</div>}

          {app && (
            <>
              <TabBar active={activeTab} tabs={TABS} onChange={setActiveTab} />

              <div style={s.tabContent}>
                {activeTab === "Overview" && (
                  <OverviewTab app={app} onRedeploy={handleRedeploy} redeploying={redeploying} />
                )}
                {activeTab === "Logs" && <LogsTab appName={appname} />}
                {activeTab === "Deploys" && <DeploysTab appName={appname} />}
                {activeTab === "Environment" && <EnvTab appName={appname} />}
                {activeTab === "Settings" && (
                  <SettingsTab app={app} appName={appname} onDelete={handleDelete} />
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </>
  );
}

const s = {
  page: { background: "#0a0a0a", color: "#fff", minHeight: "100vh", fontFamily: "system-ui, -apple-system, sans-serif" },
  nav: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 2rem", borderBottom: "1px solid #1f1f1f" },
  logo: { fontWeight: 700, fontSize: "1.25rem", color: "#fff", textDecoration: "none" },
  ctaBtn: { background: "#6366f1", color: "#fff", padding: "0.5rem 1.25rem", borderRadius: "0.5rem", textDecoration: "none", fontWeight: 600, fontSize: "0.9rem" },
  main: { maxWidth: "900px", margin: "0 auto", padding: "2rem" },
  loadingText: { color: "#6b7280", textAlign: "center", padding: "3rem" },
  errorBox: { background: "#1a0f0f", border: "1px solid #3d1515", borderRadius: "0.75rem", padding: "1rem 1.5rem", color: "#ef4444", marginBottom: "1rem" },
  successBox: { background: "#0a1a0f", border: "1px solid #15513d", borderRadius: "0.75rem", padding: "1rem 1.5rem", color: "#22c55e", marginBottom: "1rem" },
  tabBar: { display: "flex", gap: "0.25rem", borderBottom: "1px solid #1f1f1f", marginBottom: "1.75rem" },
  tab: { background: "none", border: "none", color: "#6b7280", padding: "0.75rem 1.25rem", cursor: "pointer", fontSize: "0.9rem", fontWeight: 500, borderBottom: "2px solid transparent", marginBottom: "-1px" },
  tabActive: { color: "#fff", borderBottom: "2px solid #6366f1" },
  tabContent: {},
  infoCard: { background: "#111", border: "1px solid #1f1f1f", borderRadius: "1rem", padding: "1.5rem" },
  tdLabel: { padding: "0.65rem 0", color: "#6b7280", fontSize: "0.85rem", width: "160px", verticalAlign: "middle" },
  tdValue: { padding: "0.65rem 0", fontSize: "0.9rem", verticalAlign: "middle" },
  link: { color: "#818cf8", textDecoration: "none" },
  btn: { padding: "0.55rem 1.1rem", borderRadius: "0.5rem", border: "none", cursor: "pointer", fontSize: "0.85rem", fontWeight: 600 },
  btnPrimary: { background: "#6366f1", color: "#fff" },
  btnSecondary: { background: "#1f1f1f", color: "#d1d5db" },
  terminal: { background: "#0d0d0d", border: "1px solid #1f1f1f", borderRadius: "0.75rem", padding: "1.25rem", fontSize: "0.78rem", lineHeight: "1.6", color: "#a3e635", fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: "520px", overflowY: "auto" },
  envTable: { border: "1px solid #1f1f1f", borderRadius: "0.75rem", overflow: "hidden" },
  envHeader: { display: "flex", gap: "0.75rem", padding: "0.65rem 1rem", background: "#111", color: "#6b7280", fontSize: "0.78rem", fontWeight: 700, textTransform: "uppercase", borderBottom: "1px solid #1f1f1f" },
  envRow: { display: "flex", gap: "0.75rem", padding: "0.5rem 1rem", borderBottom: "1px solid #1a1a1a", alignItems: "center" },
  envInput: { background: "#0d0d0d", border: "1px solid #2d2d2d", borderRadius: "0.4rem", padding: "0.5rem 0.75rem", color: "#fff", fontSize: "0.85rem", outline: "none" },
  removeBtn: { background: "none", border: "none", color: "#6b7280", cursor: "pointer", fontSize: "0.9rem", padding: "0.25rem 0.5rem", borderRadius: "0.3rem" },
  settingsSection: {},
  sectionTitle: { fontSize: "1rem", fontWeight: 700, margin: "0 0 1.25rem", color: "#d1d5db" },
  field: { marginBottom: "1rem" },
  label: { display: "block", fontSize: "0.82rem", color: "#9ca3af", marginBottom: "0.4rem", fontWeight: 500 },
  input: { width: "100%", background: "#111", border: "1px solid #2d2d2d", borderRadius: "0.5rem", padding: "0.65rem 1rem", color: "#fff", fontSize: "0.9rem", outline: "none", boxSizing: "border-box" },
  deployRow: { background: "#111", border: "1px solid #1f1f1f", borderRadius: "0.75rem", padding: "1rem 1.25rem" },
};
