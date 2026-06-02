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
  suspended: "#6b7280",
  error: "#ef4444",
};

function StatusBadge({ status }) {
  const color = STATUS_COLORS[status] || "#aaa";
  return (
    <span style={{
      background: color + "22",
      color,
      padding: "0.3rem 0.9rem",
      borderRadius: "2rem",
      fontSize: "0.78rem",
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
        <button key={t} onClick={() => onChange(t)}
          style={{ ...s.tab, ...(active === t ? s.tabActive : {}) }}>
          {t}
        </button>
      ))}
    </div>
  );
}

// ---- OVERVIEW ----
function OverviewTab({ app, onRedeploy, onSuspend, onResume, redeploying, suspending }) {
  if (!app) return null;
  const isSuspended = app.status === "suspended";
  const rows = [
    ["Live URL", <a key="l" href={`https://${app.subdomain}`} target="_blank" rel="noopener noreferrer" style={s.link}>https://{app.subdomain} ↗</a>],
    ["Render URL", <a key="r" href={app.render_url} target="_blank" rel="noopener noreferrer" style={s.link}>{app.render_url} ↗</a>],
    ["Status", <StatusBadge key="s" status={app.status} />],
    ["Runtime", app.runtime],
    ["Region", app.region || "oregon"],
    ["Instance", "Free"],
    ["Branch", app.branch || "main"],
    ["Root Dir", app.root_dir || "/"],
    ["Repo", app.repo_url ? <a key="repo" href={app.repo_url} target="_blank" rel="noopener noreferrer" style={s.link}>{app.repo_url.replace("https://github.com/", "")} ↗</a> : "—"],
    ["Deployed", app.deployed_at ? new Date(app.deployed_at).toLocaleString() : "—"],
    ["Last ping", app.last_ping ? new Date(app.last_ping).toLocaleString() : "—"],
    ["Fail count", app.fail_count ?? 0],
  ];

  return (
    <div>
      <div style={s.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem", flexWrap: "wrap", gap: "0.75rem" }}>
          <div>
            <h2 style={{ margin: "0 0 0.4rem", fontSize: "1.4rem", fontWeight: 700 }}>{app.app_name}</h2>
            <a href={`https://${app.subdomain}`} target="_blank" rel="noopener noreferrer" style={{ ...s.link, fontSize: "0.9rem" }}>
              https://{app.subdomain} ↗
            </a>
          </div>
          <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
            {isSuspended ? (
              <button onClick={onResume} disabled={suspending} style={{ ...s.btn, background: "#14532d", color: "#22c55e", opacity: suspending ? 0.6 : 1 }}>
                {suspending ? "Resuming…" : "▶ Resume"}
              </button>
            ) : (
              <button onClick={onSuspend} disabled={suspending} style={{ ...s.btn, ...s.btnSecondary, opacity: suspending ? 0.6 : 1 }}>
                {suspending ? "Suspending…" : "⏸ Suspend"}
              </button>
            )}
            <button onClick={onRedeploy} disabled={redeploying} style={{ ...s.btn, ...s.btnPrimary, opacity: redeploying ? 0.6 : 1 }}>
              {redeploying ? "Triggering…" : "🔄 Redeploy"}
            </button>
          </div>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label} style={{ borderBottom: "1px solid #1a1a1a" }}>
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

// ---- LOGS ----
function LogsTab({ appName }) {
  const [logs, setLogs] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef(null);

  const fetchLogs = useCallback(async () => {
    try {
      setError(null);
      const data = await apiFetch(`/logs/${appName}`);
      setLogs(data.logs || "(no logs)");
      setLastRefresh(new Date());
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [appName]);

  useEffect(() => { fetchLogs(); const t = setInterval(fetchLogs, 30000); return () => clearInterval(t); }, [fetchLogs]);
  useEffect(() => { if (autoScroll && bottomRef.current) bottomRef.current.scrollIntoView({ behavior: "smooth" }); }, [logs, autoScroll]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <span style={{ color: "#6b7280", fontSize: "0.8rem" }}>
          {lastRefresh ? `Refreshed ${lastRefresh.toLocaleTimeString()} · auto every 30s` : "Loading…"}
        </span>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <label style={{ color: "#6b7280", fontSize: "0.8rem", display: "flex", gap: "0.35rem", alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
            Auto-scroll
          </label>
          <button onClick={fetchLogs} style={{ ...s.btn, ...s.btnSecondary, padding: "0.4rem 0.75rem" }}>↻ Refresh</button>
        </div>
      </div>
      {error && <div style={s.errorBox}>{error}</div>}
      <pre style={s.terminal}>
        {loading ? "Fetching logs…" : (logs || "(no logs)")}
        <span ref={bottomRef} />
      </pre>
    </div>
  );
}

// ---- DEPLOY HISTORY ----
function DeploysTab({ appName }) {
  const [deploys, setDeploys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    apiFetch(`/deployment/${appName}/deploys`)
      .then((d) => setDeploys(d.deploys || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [appName]);

  const statusColor = (st) => ({
    live: "#22c55e", build_failed: "#ef4444", failed: "#ef4444",
    in_progress: "#f59e0b", building: "#f59e0b", created: "#818cf8",
  }[st] || "#6b7280");

  if (loading) return <div style={s.placeholder}>Loading deploy history…</div>;
  if (error) return <div style={s.errorBox}>{error}</div>;
  if (!deploys.length) return <div style={s.placeholder}>No deploys yet.</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
      {deploys.map((d, i) => (
        <div key={d.id || i} style={s.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.9rem", marginBottom: "0.2rem" }}>
                {d.commit?.message || d.commitId?.slice(0, 8) || `Deploy #${i + 1}`}
              </div>
              <div style={{ color: "#6b7280", fontSize: "0.78rem" }}>
                {d.commit?.id?.slice(0, 7) && <code style={{ marginRight: "0.75rem" }}>{d.commit.id.slice(0, 7)}</code>}
                {d.finishedAt ? new Date(d.finishedAt).toLocaleString() : d.createdAt ? new Date(d.createdAt).toLocaleString() : ""}
              </div>
            </div>
            <span style={{ color: statusColor(d.status), fontSize: "0.78rem", fontWeight: 700, textTransform: "uppercase", background: statusColor(d.status) + "18", padding: "0.25rem 0.7rem", borderRadius: "2rem", border: `1px solid ${statusColor(d.status)}33` }}>
              {d.status}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- ENVIRONMENT VARIABLES ----
function EnvTab({ appName }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [showValues, setShowValues] = useState({});

  useEffect(() => {
    apiFetch(`/deployment/${appName}/env`)
      .then((d) => {
        const vars = (d.env_vars || []).map((e) => ({ key: e.key || "", value: e.value || "" }));
        setRows(vars.length ? vars : [{ key: "", value: "" }]);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [appName]);

  const update = (i, field, val) => setRows((p) => p.map((r, idx) => idx === i ? { ...r, [field]: val } : r));
  const addRow = () => setRows((p) => [...p, { key: "", value: "" }]);
  const removeRow = (i) => setRows((p) => p.filter((_, idx) => idx !== i));
  const toggleShow = (i) => setShowValues((p) => ({ ...p, [i]: !p[i] }));

  const save = async () => {
    setSaving(true); setError(null); setSuccess(false);
    try {
      const env_vars = {};
      for (const { key, value } of rows) { if (key.trim()) env_vars[key.trim()] = value; }
      await apiFetch(`/deployment/${appName}/env`, { method: "PUT", body: JSON.stringify({ env_vars }) });
      setSuccess(true); setTimeout(() => setSuccess(false), 3000);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  if (loading) return <div style={s.placeholder}>Loading environment variables…</div>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <p style={{ color: "#9ca3af", fontSize: "0.82rem", margin: 0 }}>Changes save to Render and trigger a redeploy.</p>
      </div>
      {error && <div style={s.errorBox}>{error}</div>}
      {success && <div style={s.successBox}>Saved — redeploy triggered!</div>}
      <div style={s.envTable}>
        <div style={s.envHeader}>
          <span style={{ flex: 2 }}>Key</span>
          <span style={{ flex: 3 }}>Value</span>
          <span style={{ width: "5rem", textAlign: "center" }}>Show</span>
          <span style={{ width: "2.5rem" }} />
        </div>
        {rows.map((row, i) => (
          <div key={i} style={s.envRow}>
            <input value={row.key} onChange={(e) => update(i, "key", e.target.value)}
              placeholder="KEY" style={{ ...s.envInput, flex: 2, fontFamily: "monospace", textTransform: "uppercase" }} />
            <input value={row.value} onChange={(e) => update(i, "value", e.target.value)}
              type={showValues[i] ? "text" : "password"} placeholder="value"
              style={{ ...s.envInput, flex: 3, fontFamily: "monospace" }} />
            <button onClick={() => toggleShow(i)} style={{ ...s.iconBtn, width: "5rem" }}>{showValues[i] ? "🙈 Hide" : "👁 Show"}</button>
            <button onClick={() => removeRow(i)} style={s.removeBtn}>✕</button>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
        <button onClick={addRow} style={{ ...s.btn, ...s.btnSecondary }}>+ Add Variable</button>
        <button onClick={save} disabled={saving} style={{ ...s.btn, ...s.btnPrimary, opacity: saving ? 0.6 : 1 }}>
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </div>
  );
}

// ---- SETTINGS ----
function SettingsTab({ app, appName, onDelete }) {
  const [repoUrl, setRepoUrl] = useState(app?.repo_url || "");
  const [branch, setBranch] = useState(app?.branch || "main");
  const [rootDir, setRootDir] = useState(app?.root_dir || "");
  const [buildCmd, setBuildCmd] = useState(app?.build_command || "");
  const [startCmd, setStartCmd] = useState(app?.start_command || "");
  const [healthPath, setHealthPath] = useState(app?.health_check_path || "/");
  const [autoDeploy, setAutoDeploy] = useState(app?.auto_deploy ?? false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [dirs, setDirs] = useState([]);
  const [dirsLoading, setDirsLoading] = useState(false);

  const fetchDirs = async (url) => {
    if (!url?.includes("github.com")) return;
    setDirsLoading(true);
    try {
      const d = await apiFetch(`/repo-dirs?repo_url=${encodeURIComponent(url)}`);
      setDirs(d.dirs || []);
    } catch { setDirs([]); }
    finally { setDirsLoading(false); }
  };

  useEffect(() => { if (app?.repo_url) fetchDirs(app.repo_url); }, [app?.repo_url]);

  const save = async () => {
    setSaving(true); setError(null); setSuccess(false);
    try {
      await apiFetch(`/deployment/${appName}/settings`, {
        method: "PUT",
        body: JSON.stringify({
          repo_url: repoUrl || undefined,
          branch: branch || undefined,
          root_dir: rootDir === "__custom__" ? undefined : (rootDir || undefined),
          build_command: buildCmd || undefined,
          start_command: startCmd || undefined,
          health_check_path: healthPath || undefined,
          auto_deploy: autoDeploy,
        }),
      });
      setSuccess(true); setTimeout(() => setSuccess(false), 3000);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!confirm(`Permanently delete ${appName}? This cannot be undone.`)) return;
    setDeleting(true);
    try { await onDelete(); }
    catch (e) { setError(e.message); setDeleting(false); }
  };

  const Section = ({ title, children, danger }) => (
    <div style={{ ...s.settingsSection, ...(danger ? { borderTop: "1px solid #2d1515", paddingTop: "1.5rem" } : {}) }}>
      <h3 style={{ ...s.sectionTitle, ...(danger ? { color: "#ef4444" } : {}) }}>{title}</h3>
      {children}
    </div>
  );

  const Field = ({ label, children, hint }) => (
    <div style={s.field}>
      <label style={s.label}>{label}</label>
      {children}
      {hint && <span style={{ color: "#6b7280", fontSize: "0.78rem" }}>{hint}</span>}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
      {error && <div style={s.errorBox}>{error}</div>}
      {success && <div style={s.successBox}>Settings updated on Render!</div>}

      <Section title="Repository & Branch">
        <Field label="Repository URL">
          <input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)}
            onBlur={(e) => fetchDirs(e.target.value)} style={s.input} placeholder="https://github.com/user/repo" />
        </Field>
        <Field label="Branch">
          <input value={branch} onChange={(e) => setBranch(e.target.value)} style={s.input} placeholder="main" />
        </Field>
        <Field label={`Root Directory${dirsLoading ? " (loading…)" : ""}`}
          hint="Which folder to run build/start commands from">
          {dirs.length > 0 ? (
            <>
              <select value={rootDir} onChange={(e) => setRootDir(e.target.value)}
                style={{ ...s.input, cursor: "pointer" }}>
                <option value="">/ (repo root)</option>
                {dirs.map((d) => <option key={d} value={d}>{d}/</option>)}
                <option value="__custom__">Custom…</option>
              </select>
              {rootDir === "__custom__" && (
                <input autoFocus placeholder="e.g. backend" style={{ ...s.input, marginTop: "0.5rem" }}
                  onChange={(e) => setRootDir(e.target.value)} />
              )}
            </>
          ) : (
            <input value={rootDir} onChange={(e) => setRootDir(e.target.value)} style={s.input} placeholder="e.g. backend (leave blank for root)" />
          )}
        </Field>
      </Section>

      <Section title="Build & Start Commands">
        <Field label="Build Command" hint="e.g. npm install · pip install -r requirements.txt">
          <input value={buildCmd} onChange={(e) => setBuildCmd(e.target.value)} style={{ ...s.input, fontFamily: "monospace" }} placeholder="uses runtime default" />
        </Field>
        <Field label="Start Command" hint="e.g. npm start · uvicorn main:app --host 0.0.0.0 --port $PORT">
          <input value={startCmd} onChange={(e) => setStartCmd(e.target.value)} style={{ ...s.input, fontFamily: "monospace" }} placeholder="uses runtime default" />
        </Field>
      </Section>

      <Section title="Health & Deploy">
        <Field label="Health Check Path" hint="Render pings this URL to determine if the service is up">
          <input value={healthPath} onChange={(e) => setHealthPath(e.target.value)} style={{ ...s.input, fontFamily: "monospace" }} placeholder="/" />
        </Field>
        <Field label="Auto-Deploy">
          <label style={{ display: "flex", gap: "0.6rem", alignItems: "center", cursor: "pointer", color: "#d1d5db", fontSize: "0.9rem" }}>
            <input type="checkbox" checked={autoDeploy} onChange={(e) => setAutoDeploy(e.target.checked)}
              style={{ width: "1rem", height: "1rem" }} />
            Automatically deploy on every git push
          </label>
        </Field>
        <Field label="Instance Type">
          <input value="Free" disabled style={{ ...s.input, color: "#6b7280", cursor: "not-allowed" }} />
        </Field>
      </Section>

      <button onClick={save} disabled={saving} style={{ ...s.btn, ...s.btnPrimary, opacity: saving ? 0.6 : 1, alignSelf: "flex-start" }}>
        {saving ? "Saving…" : "Save Settings"}
      </button>

      <Section title="Danger Zone" danger>
        <p style={{ color: "#9ca3af", fontSize: "0.85rem", marginBottom: "1rem" }}>
          Permanently deletes this service, DNS record, and removes it from all accounts. This cannot be undone.
        </p>
        <button onClick={handleDelete} disabled={deleting}
          style={{ ...s.btn, background: "#2d1515", color: "#ef4444", opacity: deleting ? 0.6 : 1 }}>
          {deleting ? "Deleting…" : "Delete Service"}
        </button>
      </Section>
    </div>
  );
}

// ---- EVENTS LOG ----
function EventsTab({ appName }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch(`/deployment/${appName}/deploys`)
      .then((d) => setEvents(d.deploys || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [appName]);

  const typeLabel = (d) => {
    if (d.status === "live") return { label: "Deploy succeeded", color: "#22c55e" };
    if (d.status === "build_failed" || d.status === "failed") return { label: "Deploy failed", color: "#ef4444" };
    if (d.status === "in_progress" || d.status === "building") return { label: "Deploy in progress", color: "#f59e0b" };
    return { label: "Deploy created", color: "#818cf8" };
  };

  if (loading) return <div style={s.placeholder}>Loading events…</div>;
  if (!events.length) return <div style={s.placeholder}>No events yet.</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
      {events.map((d, i) => {
        const { label, color } = typeLabel(d);
        const ts = d.finishedAt || d.createdAt;
        return (
          <div key={d.id || i} style={{ display: "flex", gap: "1rem", padding: "0.85rem 0", borderBottom: "1px solid #1a1a1a", alignItems: "flex-start" }}>
            <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: color, marginTop: "5px", flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: "0.88rem", fontWeight: 500 }}>{label}</div>
              {d.commit?.message && <div style={{ color: "#6b7280", fontSize: "0.78rem", marginTop: "0.15rem" }}>{d.commit.message}</div>}
              <div style={{ color: "#4b5563", fontSize: "0.75rem", marginTop: "0.2rem" }}>{ts ? new Date(ts).toLocaleString() : ""}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- MAIN PAGE ----
const TABS = ["Overview", "Logs", "Deploys", "Events", "Environment", "Settings"];

export default function AppDetail() {
  const router = useRouter();
  const { appname } = router.query;
  const owner = typeof window !== "undefined" ? localStorage.getItem("airdeploy_owner") || "" : "";

  const [app, setApp] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("Overview");
  const [redeploying, setRedeploying] = useState(false);
  const [suspending, setSuspending] = useState(false);
  const [notice, setNotice] = useState(null);

  const showNotice = (msg, ok = true) => {
    setNotice({ msg, ok });
    setTimeout(() => setNotice(null), 3500);
  };

  const fetchApp = useCallback(async () => {
    if (!appname) return;
    try {
      const data = await apiFetch(`/deployment/${appname}`);
      setApp(data); setError(null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [appname]);

  useEffect(() => { fetchApp(); const t = setInterval(fetchApp, 15000); return () => clearInterval(t); }, [fetchApp]);

  const handleRedeploy = async () => {
    setRedeploying(true);
    try {
      await apiFetch(`/redeploy/${appname}`, { method: "POST", body: JSON.stringify({ owner }) });
      showNotice("Redeploy triggered!");
    } catch (e) { showNotice(e.message, false); }
    finally { setRedeploying(false); }
  };

  const handleSuspend = async () => {
    setSuspending(true);
    try {
      await apiFetch(`/deployment/${appname}/suspend`, { method: "POST" });
      showNotice("Service suspended.");
      await fetchApp();
    } catch (e) { showNotice(e.message, false); }
    finally { setSuspending(false); }
  };

  const handleResume = async () => {
    setSuspending(true);
    try {
      await apiFetch(`/deployment/${appname}/resume`, { method: "POST" });
      showNotice("Service resuming…");
      await fetchApp();
    } catch (e) { showNotice(e.message, false); }
    finally { setSuspending(false); }
  };

  const handleDelete = async () => {
    await apiFetch(`/undeploy/${appname}`, { method: "DELETE", body: JSON.stringify({ owner }) });
    router.push("/dashboard" + (owner ? `?owner=${owner}` : ""));
  };

  return (
    <>
      <Head><title>{appname || "App"} — AirDeploy</title></Head>
      <div style={s.page}>
        <nav style={s.nav}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <Link href="/" style={s.logo}>⚡ AirDeploy</Link>
            <span style={{ color: "#2d2d2d" }}>/</span>
            <Link href={`/dashboard${owner ? `?owner=${owner}` : ""}`} style={{ color: "#6b7280", textDecoration: "none", fontSize: "0.88rem" }}>Dashboard</Link>
            <span style={{ color: "#2d2d2d" }}>/</span>
            <span style={{ color: "#d1d5db", fontSize: "0.88rem", fontWeight: 600 }}>{appname}</span>
          </div>
          <Link href="/deploy" style={s.ctaBtn}>+ New Deployment</Link>
        </nav>

        <main style={s.main}>
          {notice && (
            <div style={{ ...s.noticeBanner, background: notice.ok ? "#0a1a0f" : "#1a0f0f", color: notice.ok ? "#22c55e" : "#ef4444", border: `1px solid ${notice.ok ? "#15513d" : "#3d1515"}` }}>
              {notice.msg}
            </div>
          )}

          {loading && <div style={s.placeholder}>Loading…</div>}
          {error && !loading && <div style={s.errorBox}>Error: {error}</div>}

          {app && (
            <>
              <TabBar active={activeTab} tabs={TABS} onChange={setActiveTab} />
              <div style={s.tabContent}>
                {activeTab === "Overview" && (
                  <OverviewTab app={app} onRedeploy={handleRedeploy} onSuspend={handleSuspend}
                    onResume={handleResume} redeploying={redeploying} suspending={suspending} />
                )}
                {activeTab === "Logs" && <LogsTab appName={appname} />}
                {activeTab === "Deploys" && <DeploysTab appName={appname} />}
                {activeTab === "Events" && <EventsTab appName={appname} />}
                {activeTab === "Environment" && <EnvTab appName={appname} />}
                {activeTab === "Settings" && <SettingsTab app={app} appName={appname} onDelete={handleDelete} />}
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
  nav: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 2rem", borderBottom: "1px solid #1a1a1a" },
  logo: { fontWeight: 700, fontSize: "1.2rem", color: "#fff", textDecoration: "none" },
  ctaBtn: { background: "#6366f1", color: "#fff", padding: "0.5rem 1.1rem", borderRadius: "0.5rem", textDecoration: "none", fontWeight: 600, fontSize: "0.85rem" },
  main: { maxWidth: "900px", margin: "0 auto", padding: "2rem" },
  placeholder: { color: "#6b7280", textAlign: "center", padding: "3rem" },
  noticeBanner: { borderRadius: "0.6rem", padding: "0.75rem 1.25rem", marginBottom: "1.25rem", fontSize: "0.88rem", fontWeight: 500 },
  errorBox: { background: "#1a0f0f", border: "1px solid #3d1515", borderRadius: "0.6rem", padding: "0.9rem 1.25rem", color: "#ef4444", marginBottom: "1rem" },
  successBox: { background: "#0a1a0f", border: "1px solid #15513d", borderRadius: "0.6rem", padding: "0.9rem 1.25rem", color: "#22c55e", marginBottom: "1rem" },
  tabBar: { display: "flex", gap: "0.1rem", borderBottom: "1px solid #1a1a1a", marginBottom: "1.75rem", overflowX: "auto" },
  tab: { background: "none", border: "none", color: "#6b7280", padding: "0.75rem 1.1rem", cursor: "pointer", fontSize: "0.88rem", fontWeight: 500, borderBottom: "2px solid transparent", marginBottom: "-1px", whiteSpace: "nowrap" },
  tabActive: { color: "#fff", borderBottom: "2px solid #6366f1" },
  tabContent: {},
  card: { background: "#111", border: "1px solid #1f1f1f", borderRadius: "0.875rem", padding: "1.5rem" },
  tdLabel: { padding: "0.6rem 0", color: "#6b7280", fontSize: "0.82rem", width: "150px", verticalAlign: "middle" },
  tdValue: { padding: "0.6rem 0", fontSize: "0.88rem", verticalAlign: "middle" },
  link: { color: "#818cf8", textDecoration: "none" },
  btn: { padding: "0.5rem 1rem", borderRadius: "0.5rem", border: "none", cursor: "pointer", fontSize: "0.85rem", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "0.3rem" },
  btnPrimary: { background: "#6366f1", color: "#fff" },
  btnSecondary: { background: "#1f1f1f", color: "#d1d5db" },
  terminal: { background: "#0d0d0d", border: "1px solid #1f1f1f", borderRadius: "0.75rem", padding: "1.25rem", fontSize: "0.76rem", lineHeight: "1.65", color: "#a3e635", fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: "540px", overflowY: "auto" },
  envTable: { border: "1px solid #1f1f1f", borderRadius: "0.75rem", overflow: "hidden" },
  envHeader: { display: "flex", gap: "0.75rem", padding: "0.6rem 1rem", background: "#0d0d0d", color: "#6b7280", fontSize: "0.74rem", fontWeight: 700, textTransform: "uppercase", borderBottom: "1px solid #1f1f1f" },
  envRow: { display: "flex", gap: "0.75rem", padding: "0.45rem 1rem", borderBottom: "1px solid #141414", alignItems: "center" },
  envInput: { background: "#0a0a0a", border: "1px solid #2d2d2d", borderRadius: "0.4rem", padding: "0.45rem 0.7rem", color: "#fff", fontSize: "0.82rem", outline: "none" },
  iconBtn: { background: "none", border: "none", color: "#6b7280", cursor: "pointer", fontSize: "0.72rem", padding: "0.35rem 0.5rem", borderRadius: "0.3rem" },
  removeBtn: { background: "none", border: "none", color: "#6b7280", cursor: "pointer", fontSize: "0.88rem", padding: "0.25rem 0.5rem", borderRadius: "0.3rem" },
  settingsSection: { display: "flex", flexDirection: "column", gap: "1rem" },
  sectionTitle: { fontSize: "0.95rem", fontWeight: 700, margin: "0 0 0.5rem", color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", fontSize: "0.75rem" },
  field: { display: "flex", flexDirection: "column", gap: "0.4rem" },
  label: { fontSize: "0.85rem", fontWeight: 600, color: "#d1d5db" },
  input: { background: "#111", border: "1px solid #2d2d2d", borderRadius: "0.5rem", padding: "0.65rem 1rem", color: "#fff", fontSize: "0.88rem", outline: "none", width: "100%", boxSizing: "border-box" },
};
