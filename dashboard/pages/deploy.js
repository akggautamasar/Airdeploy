import { useState, useRef } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";

const API = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL || "";
const SECRET = process.env.NEXT_PUBLIC_ORCHESTRATOR_SECRET || "";

function EnvVarsEditor({ pairs, onChange }) {
  const addPair = () => onChange([...pairs, { key: "", value: "" }]);
  const removePair = (i) => onChange(pairs.filter((_, idx) => idx !== i));
  const updatePair = (i, field, val) => {
    const updated = [...pairs];
    updated[i] = { ...updated[i], [field]: val };
    onChange(updated);
  };

  return (
    <div>
      {pairs.map((pair, i) => (
        <div key={i} style={styles.envRow}>
          <input
            placeholder="KEY"
            value={pair.key}
            onChange={(e) => updatePair(i, "key", e.target.value)}
            style={{ ...styles.input, flex: 1, fontFamily: "monospace" }}
          />
          <input
            placeholder="VALUE"
            value={pair.value}
            onChange={(e) => updatePair(i, "value", e.target.value)}
            style={{ ...styles.input, flex: 2, fontFamily: "monospace" }}
          />
          <button onClick={() => removePair(i)} style={styles.removeBtn} type="button">
            ✕
          </button>
        </div>
      ))}
      <button onClick={addPair} type="button" style={styles.addEnvBtn}>
        + Add Variable
      </button>
    </div>
  );
}

export default function Deploy() {
  const router = useRouter();
  const [form, setForm] = useState({
    repo_url: "",
    app_name: "",
    runtime: "",
    owner: typeof window !== "undefined" ? localStorage.getItem("airdeploy_owner") || "" : "",
  });
  const [envPairs, setEnvPairs] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [logs, setLogs] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const logsRef = useRef(null);

  const addLog = (msg) => {
    setLogs((prev) => {
      const next = [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`];
      setTimeout(() => logsRef.current?.scrollTo(0, logsRef.current.scrollHeight), 10);
      return next;
    });
  };

  const handleChange = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const validateAppName = (name) => /^[a-z0-9][a-z0-9\-]{1,61}[a-z0-9]$/.test(name);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    setLogs([]);

    if (!validateAppName(form.app_name)) {
      setError("App name must be lowercase alphanumeric with hyphens, 3–63 chars.");
      return;
    }
    if (!form.owner.trim()) {
      setError("Owner / username is required.");
      return;
    }

    const env_vars = {};
    for (const { key, value } of envPairs) {
      if (key.trim()) env_vars[key.trim()] = value;
    }

    if (form.owner) {
      localStorage.setItem("airdeploy_owner", form.owner);
    }

    setSubmitting(true);
    addLog("Submitting deploy request...");

    const payload = {
      repo_url: form.repo_url,
      app_name: form.app_name,
      runtime: form.runtime || undefined,
      owner: form.owner,
      env_vars,
    };

    try {
      addLog(`Deploying ${form.app_name} from ${form.repo_url}...`);
      if (!form.runtime) addLog("Auto-detecting runtime from repo...");

      // Step 1: kick off deploy (returns immediately)
      const resp = await fetch(`${API}/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Secret": SECRET },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(errData.detail || resp.statusText);
      }

      addLog("✅ Deploy started on Render. Waiting for it to go live (5-10 min)...");
      addLog("💡 You can leave this page — check the dashboard for status.");

      // Step 2: poll GET /deployment/{app_name} until alive or error
      let attempts = 0;
      const maxAttempts = 40; // 40 × 15s = 10 minutes
      const appName = form.app_name;

      const poll = async () => {
        attempts++;
        try {
          const statusResp = await fetch(`${API}/deployment/${appName}`, {
            headers: { "X-Secret": SECRET },
          });
          if (statusResp.ok) {
            const dep = await statusResp.json();
            if (dep.status === "alive") {
              const subdomain = dep.subdomain || `${appName}.${process.env.NEXT_PUBLIC_BASE_DOMAIN || "akggautam.site"}`;
              const renderUrl = dep.render_url || `https://${appName}.onrender.com`;
              addLog(`🎉 App is live at: https://${subdomain}`);
              setResult({
                subdomain,
                render_url: renderUrl,
                service_id: dep.render_service_id || dep.service_id || "",
                status: "alive",
              });
              import("canvas-confetti").then(({ default: confetti }) => {
                confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });
              });
              return;
            } else if (dep.status === "error") {
              throw new Error("Deploy failed on Render. Check logs.");
            }
          }
        } catch (e) {
          if (e.message.includes("Deploy failed")) throw e;
        }

        if (attempts >= maxAttempts) {
          throw new Error("Timed out waiting for deploy. Check dashboard for status.");
        }
        addLog(`⏳ Still building... (${attempts * 15}s elapsed)`);
        setTimeout(poll, 15000);
      };

      setTimeout(poll, 15000);
    } catch (err) {
      addLog(`❌ Deploy failed: ${err.message}`);
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Head>
        <title>Deploy — AirDeploy</title>
      </Head>
      <div style={styles.page}>
        <nav style={styles.nav}>
          <Link href="/" style={styles.logo}>⚡ AirDeploy</Link>
          <Link href="/dashboard" style={styles.navLink}>Dashboard</Link>
        </nav>

        <main style={styles.main}>
          <h1 style={styles.title}>Deploy a new app</h1>
          <p style={styles.subtitle}>Fill in the details below and we'll deploy your app to a live URL.</p>

          {!result ? (
            <form onSubmit={handleSubmit} style={styles.form}>
              <div style={styles.field}>
                <label style={styles.label}>GitHub Repo URL *</label>
                <input
                  type="url"
                  placeholder="https://github.com/username/repo"
                  value={form.repo_url}
                  onChange={handleChange("repo_url")}
                  required
                  style={styles.input}
                />
              </div>

              <div style={styles.field}>
                <label style={styles.label}>App Name *</label>
                <input
                  type="text"
                  placeholder="my-awesome-app"
                  value={form.app_name}
                  onChange={(e) => handleChange("app_name")({ target: { value: e.target.value.toLowerCase() } })}
                  required
                  pattern="[a-z0-9][a-z0-9\-]{1,61}[a-z0-9]"
                  style={styles.input}
                />
                <span style={styles.hint}>Lowercase, alphanumeric and hyphens, 3–63 chars. Your URL: {form.app_name || "yourapp"}.airdeploy.xyz</span>
              </div>

              <div style={styles.field}>
                <label style={styles.label}>Runtime</label>
                <select value={form.runtime} onChange={handleChange("runtime")} style={styles.select}>
                  <option value="">Auto-detect from repo</option>
                  <option value="node">Node.js</option>
                  <option value="python">Python</option>
                  <option value="static">Static</option>
                </select>
              </div>

              <div style={styles.field}>
                <label style={styles.label}>Your Username *</label>
                <input
                  type="text"
                  placeholder="username"
                  value={form.owner}
                  onChange={handleChange("owner")}
                  required
                  style={styles.input}
                />
                <span style={styles.hint}>Used to identify your deployments in the dashboard.</span>
              </div>

              <div style={styles.field}>
                <label style={styles.label}>Environment Variables</label>
                <EnvVarsEditor pairs={envPairs} onChange={setEnvPairs} />
              </div>

              {error && <div style={styles.errorBox}>{error}</div>}

              {logs.length > 0 && (
                <div style={styles.logBox} ref={logsRef}>
                  {logs.map((l, i) => <div key={i}>{l}</div>)}
                </div>
              )}

              <button type="submit" disabled={submitting} style={styles.submitBtn}>
                {submitting ? "⏳ Deploying..." : "🚀 Deploy App"}
              </button>
            </form>
          ) : (
            <div style={styles.successCard}>
              <div style={styles.successIcon}>🎉</div>
              <h2 style={styles.successTitle}>Your app is live!</h2>
              <a
                href={`https://${result.subdomain}`}
                target="_blank"
                rel="noopener noreferrer"
                style={styles.liveLink}
              >
                https://{result.subdomain} ↗
              </a>
              <div style={styles.successMeta}>
                <div>Service ID: <code style={styles.code}>{result.service_id}</code></div>
                <div>Render URL: <code style={styles.code}>{result.render_url}</code></div>
              </div>
              <div style={styles.successActions}>
                <Link href="/dashboard" style={styles.dashBtn}>View Dashboard</Link>
                <button onClick={() => { setResult(null); setLogs([]); setForm(f => ({ ...f, repo_url: "", app_name: "" })); }} style={styles.deployAnotherBtn}>
                  Deploy Another
                </button>
              </div>
              {logs.length > 0 && (
                <div style={{ ...styles.logBox, marginTop: "1.5rem" }}>
                  {logs.map((l, i) => <div key={i}>{l}</div>)}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </>
  );
}

const styles = {
  page: { background: "#0a0a0a", color: "#fff", minHeight: "100vh", fontFamily: "system-ui, -apple-system, sans-serif" },
  nav: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 2rem", borderBottom: "1px solid #1f1f1f" },
  logo: { fontWeight: 700, fontSize: "1.25rem", color: "#fff", textDecoration: "none" },
  navLink: { color: "#9ca3af", textDecoration: "none" },
  main: { maxWidth: "640px", margin: "0 auto", padding: "3rem 2rem" },
  title: { fontSize: "2rem", fontWeight: 700, margin: "0 0 0.5rem", letterSpacing: "-0.02em" },
  subtitle: { color: "#6b7280", margin: "0 0 2.5rem", fontSize: "1rem" },
  form: { display: "flex", flexDirection: "column", gap: "1.5rem" },
  field: { display: "flex", flexDirection: "column", gap: "0.5rem" },
  label: { fontWeight: 600, fontSize: "0.9rem", color: "#d1d5db" },
  input: { background: "#111", border: "1px solid #2d2d2d", borderRadius: "0.5rem", padding: "0.75rem 1rem", color: "#fff", fontSize: "0.95rem", outline: "none", width: "100%", boxSizing: "border-box" },
  select: { background: "#111", border: "1px solid #2d2d2d", borderRadius: "0.5rem", padding: "0.75rem 1rem", color: "#fff", fontSize: "0.95rem", outline: "none", width: "100%", boxSizing: "border-box" },
  hint: { color: "#6b7280", fontSize: "0.8rem" },
  envRow: { display: "flex", gap: "0.5rem", marginBottom: "0.5rem", alignItems: "center" },
  removeBtn: { background: "#1f1f1f", border: "none", color: "#ef4444", borderRadius: "0.4rem", padding: "0.6rem 0.75rem", cursor: "pointer", fontWeight: 700, flexShrink: 0 },
  addEnvBtn: { background: "transparent", border: "1px dashed #2d2d2d", color: "#6b7280", borderRadius: "0.5rem", padding: "0.5rem 1rem", cursor: "pointer", fontSize: "0.85rem", width: "100%", marginTop: "0.25rem" },
  errorBox: { background: "#1a0f0f", border: "1px solid #3d1515", borderRadius: "0.75rem", padding: "1rem 1.5rem", color: "#ef4444" },
  logBox: { background: "#060606", border: "1px solid #1f1f1f", borderRadius: "0.75rem", padding: "1rem 1.25rem", fontFamily: "monospace", fontSize: "0.82rem", color: "#a3e635", maxHeight: "280px", overflowY: "auto", lineHeight: 1.7, whiteSpace: "pre-wrap" },
  submitBtn: { background: "linear-gradient(135deg, #6366f1, #7c3aed)", color: "#fff", border: "none", borderRadius: "0.75rem", padding: "1rem", fontSize: "1.05rem", fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 20px rgba(99,102,241,0.4)" },
  successCard: { background: "#111", border: "1px solid #1f1f1f", borderRadius: "1.25rem", padding: "2.5rem", textAlign: "center" },
  successIcon: { fontSize: "3rem", marginBottom: "1rem" },
  successTitle: { fontSize: "1.75rem", fontWeight: 700, margin: "0 0 1.25rem" },
  liveLink: { display: "block", fontSize: "1.15rem", color: "#818cf8", marginBottom: "1.5rem", textDecoration: "none", fontWeight: 600 },
  successMeta: { color: "#6b7280", fontSize: "0.85rem", lineHeight: 2, marginBottom: "2rem" },
  code: { color: "#a78bfa", fontFamily: "monospace", fontSize: "0.85em" },
  successActions: { display: "flex", gap: "1rem", justifyContent: "center", flexWrap: "wrap" },
  dashBtn: { background: "#6366f1", color: "#fff", padding: "0.75rem 1.5rem", borderRadius: "0.5rem", textDecoration: "none", fontWeight: 600 },
  deployAnotherBtn: { background: "transparent", color: "#9ca3af", padding: "0.75rem 1.5rem", borderRadius: "0.5rem", border: "1px solid #2d2d2d", cursor: "pointer", fontWeight: 600 },
};
