import Head from "next/head";
import Link from "next/link";

export default function Landing() {
  return (
    <>
      <Head>
        <title>AirDeploy — Deploy Your App in Minutes</title>
        <meta name="description" content="Free PaaS platform. Push a GitHub repo, get a live URL instantly." />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div style={styles.page}>
        <nav style={styles.nav}>
          <span style={styles.logo}>⚡ AirDeploy</span>
          <div style={styles.navLinks}>
            <Link href="/dashboard" style={styles.navLink}>Dashboard</Link>
            <Link href="/deploy" style={styles.ctaBtn}>Deploy Now</Link>
          </div>
        </nav>

        <section style={styles.hero}>
          <div style={styles.badge}>Free Forever · No Credit Card</div>
          <h1 style={styles.heroTitle}>
            Deploy your app<br />
            <span style={styles.heroAccent}>in 2 minutes</span>
          </h1>
          <p style={styles.heroSub}>
            Submit a GitHub repo, get a live URL like{" "}
            <code style={styles.code}>yourapp.airdeploy.xyz</code>.<br />
            Powered by Render free tier. Zero config.
          </p>
          <div style={styles.heroCta}>
            <Link href="/deploy" style={styles.primaryBtn}>
              🚀 Deploy a Repo
            </Link>
            <Link href="/dashboard" style={styles.secondaryBtn}>
              View Dashboard
            </Link>
          </div>
        </section>

        <section style={styles.features}>
          <h2 style={styles.sectionTitle}>Everything you need to ship</h2>
          <div style={styles.grid}>
            {FEATURES.map((f) => (
              <div key={f.title} style={styles.card}>
                <div style={styles.cardIcon}>{f.icon}</div>
                <h3 style={styles.cardTitle}>{f.title}</h3>
                <p style={styles.cardDesc}>{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section style={styles.howItWorks}>
          <h2 style={styles.sectionTitle}>How it works</h2>
          <div style={styles.steps}>
            {STEPS.map((s, i) => (
              <div key={i} style={styles.step}>
                <div style={styles.stepNum}>{i + 1}</div>
                <div>
                  <h3 style={styles.stepTitle}>{s.title}</h3>
                  <p style={styles.stepDesc}>{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <footer style={styles.footer}>
          <p>Built with ❤️ on Render, Vercel, Telegram & Cloudflare</p>
        </footer>
      </div>
    </>
  );
}

const FEATURES = [
  { icon: "⚡", title: "Instant Deploys", desc: "Push a GitHub URL and your app goes live in minutes. No YAML, no Docker, no config." },
  { icon: "🌐", title: "Custom Subdomain", desc: "Every app gets a free subdomain: yourapp.airdeploy.xyz, routed via Cloudflare." },
  { icon: "🔄", title: "Auto Keep-Alive", desc: "Cron pings every 10 minutes to prevent Render free-tier spin-down." },
  { icon: "📦", title: "Multi-Runtime", desc: "Node.js, Python, and Static sites. Auto-detected from your repo." },
  { icon: "🔑", title: "Env Variables", desc: "Securely pass environment variables to your deployed app." },
  { icon: "📊", title: "Live Logs", desc: "Stream logs directly from your Render service in the dashboard." },
];

const STEPS = [
  { title: "Submit your repo", desc: "Paste a GitHub URL, pick a name, and choose your runtime." },
  { title: "We deploy it", desc: "AirDeploy picks a free Render account, deploys your app, and waits for it to go live." },
  { title: "DNS in seconds", desc: "A Cloudflare CNAME is created: yourapp.airdeploy.xyz → your Render URL." },
  { title: "Share the link", desc: "Your app is live. Share it, use it, redeploy it anytime from the dashboard." },
];

const styles = {
  page: { background: "#0a0a0a", color: "#fff", minHeight: "100vh", fontFamily: "system-ui, -apple-system, sans-serif" },
  nav: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 2rem", borderBottom: "1px solid #1f1f1f", position: "sticky", top: 0, background: "#0a0a0a", zIndex: 10 },
  logo: { fontWeight: 700, fontSize: "1.25rem", letterSpacing: "-0.02em" },
  navLinks: { display: "flex", gap: "1rem", alignItems: "center" },
  navLink: { color: "#aaa", textDecoration: "none", fontSize: "0.95rem" },
  ctaBtn: { background: "#6366f1", color: "#fff", padding: "0.5rem 1.25rem", borderRadius: "0.5rem", textDecoration: "none", fontWeight: 600, fontSize: "0.9rem" },
  hero: { textAlign: "center", padding: "6rem 2rem 4rem", maxWidth: "800px", margin: "0 auto" },
  badge: { display: "inline-block", background: "#1a1a2e", color: "#818cf8", padding: "0.35rem 1rem", borderRadius: "2rem", fontSize: "0.8rem", fontWeight: 600, marginBottom: "1.5rem", border: "1px solid #3730a3" },
  heroTitle: { fontSize: "clamp(2.5rem, 6vw, 4rem)", fontWeight: 800, lineHeight: 1.1, margin: "0 0 1.5rem", letterSpacing: "-0.03em" },
  heroAccent: { background: "linear-gradient(135deg, #6366f1, #a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" },
  heroSub: { fontSize: "1.15rem", color: "#9ca3af", lineHeight: 1.7, margin: "0 0 2.5rem" },
  code: { background: "#1f1f1f", color: "#a78bfa", padding: "0.15rem 0.4rem", borderRadius: "0.3rem", fontFamily: "monospace", fontSize: "0.9em" },
  heroCta: { display: "flex", gap: "1rem", justifyContent: "center", flexWrap: "wrap" },
  primaryBtn: { background: "linear-gradient(135deg, #6366f1, #7c3aed)", color: "#fff", padding: "0.85rem 2rem", borderRadius: "0.75rem", textDecoration: "none", fontWeight: 700, fontSize: "1.05rem", boxShadow: "0 4px 20px rgba(99,102,241,0.4)" },
  secondaryBtn: { background: "transparent", color: "#9ca3af", padding: "0.85rem 2rem", borderRadius: "0.75rem", textDecoration: "none", fontWeight: 600, fontSize: "1.05rem", border: "1px solid #2d2d2d" },
  features: { padding: "5rem 2rem", maxWidth: "1100px", margin: "0 auto" },
  sectionTitle: { textAlign: "center", fontSize: "2rem", fontWeight: 700, marginBottom: "3rem", letterSpacing: "-0.02em" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1.5rem" },
  card: { background: "#111", border: "1px solid #1f1f1f", borderRadius: "1rem", padding: "1.75rem" },
  cardIcon: { fontSize: "2rem", marginBottom: "1rem" },
  cardTitle: { fontWeight: 700, marginBottom: "0.5rem", fontSize: "1.1rem" },
  cardDesc: { color: "#6b7280", lineHeight: 1.6, margin: 0, fontSize: "0.95rem" },
  howItWorks: { padding: "5rem 2rem", maxWidth: "700px", margin: "0 auto" },
  steps: { display: "flex", flexDirection: "column", gap: "2rem" },
  step: { display: "flex", gap: "1.5rem", alignItems: "flex-start" },
  stepNum: { width: "40px", height: "40px", borderRadius: "50%", background: "linear-gradient(135deg, #6366f1, #7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, flexShrink: 0 },
  stepTitle: { fontWeight: 700, margin: "0 0 0.35rem", fontSize: "1.05rem" },
  stepDesc: { color: "#6b7280", margin: 0, lineHeight: 1.6, fontSize: "0.95rem" },
  footer: { textAlign: "center", padding: "3rem 2rem", color: "#4b5563", borderTop: "1px solid #1f1f1f" },
};
