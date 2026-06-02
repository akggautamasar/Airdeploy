const CACHE_TTL_MS = 60_000;
const registryCache = new Map();
let cachePopulatedAt = 0;

async function fetchRegistry() {
  const now = Date.now();
  if (now - cachePopulatedAt < CACHE_TTL_MS && registryCache.size > 0) {
    return registryCache;
  }

  const orchestratorUrl = process.env.ORCHESTRATOR_URL;
  const orchestratorSecret = process.env.ORCHESTRATOR_SECRET;

  if (!orchestratorUrl) return registryCache;

  try {
    const resp = await fetch(`${orchestratorUrl}/deployments`, {
      headers: { "X-Secret": orchestratorSecret || "" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return registryCache;

    const deployments = await resp.json();
    const fresh = new Map();

    for (const dep of deployments) {
      if (dep.app_name && dep.render_url) {
        fresh.set(dep.app_name, {
          render_url: dep.render_url,
          status: dep.status,
        });
      }
    }

    if (fresh.size > 0) {
      registryCache.clear();
      for (const [k, v] of fresh) registryCache.set(k, v);
      cachePopulatedAt = now;
    }
  } catch {}

  return registryCache;
}

function extractSubdomain(host) {
  const baseDomain = process.env.BASE_DOMAIN || "airdeploy.xyz";
  if (!host) return null;
  const cleanHost = host.split(":")[0];
  if (!cleanHost.endsWith(`.${baseDomain}`)) return null;
  return cleanHost.slice(0, -(baseDomain.length + 1));
}

function notFoundPage(appName) {
  return new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><title>404 — AirDeploy</title>
    <style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f0f0f;color:#fff}
    .card{text-align:center;padding:2rem}h1{font-size:4rem;margin:0;color:#ff4444}p{color:#aaa;margin:.5rem 0}a{color:#60a5fa;text-decoration:none}</style>
    </head><body><div class="card"><h1>404</h1>
    <p>App <strong>${appName || "unknown"}</strong> not found on AirDeploy.</p>
    <p><a href="https://airdeploy.xyz">← Back to AirDeploy</a></p></div></body></html>`,
    { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

// Runs on all paths except /api/* (those go directly to api/ functions)
export const config = {
  matcher: ["/((?!api/)(?!_next/).*)"],
};

export default async function middleware(request) {
  const host = request.headers.get("host") || "";
  const subdomain = extractSubdomain(host);

  // No subdomain — root domain visit, show status
  if (!subdomain) {
    return new Response(
      JSON.stringify({ name: "AirDeploy Gateway", status: "running", docs: "https://airdeploy.xyz" }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  const registry = await fetchRegistry();
  const entry = registry.get(subdomain);

  if (!entry) {
    return notFoundPage(subdomain);
  }

  if (entry.status === "suspended") {
    return new Response(
      `<!DOCTYPE html><html><head><title>Suspended</title>
      <style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0f0f0f;color:#fff}
      .c{text-align:center}h1{color:#f59e0b}</style></head>
      <body><div class="c"><h1>Suspended</h1><p>${subdomain} is spinning up. Try again in 30s.</p></div></body></html>`,
      { status: 503, headers: { "Content-Type": "text/html", "Retry-After": "30" } }
    );
  }

  const targetUrl = entry.render_url;
  const incomingUrl = new URL(request.url);
  const proxyUrl = new URL(incomingUrl.pathname + incomingUrl.search, targetUrl);

  const proxyHeaders = new Headers(request.headers);
  proxyHeaders.set("host", new URL(targetUrl).hostname);
  proxyHeaders.set("x-forwarded-host", host);
  proxyHeaders.set("x-forwarded-for", request.headers.get("cf-connecting-ip") || "");

  try {
    return await fetch(new Request(proxyUrl.toString(), {
      method: request.method,
      headers: proxyHeaders,
      body: ["GET", "HEAD"].includes(request.method) ? null : request.body,
      redirect: "follow",
    }), { signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Gateway error", detail: String(err) }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
}
