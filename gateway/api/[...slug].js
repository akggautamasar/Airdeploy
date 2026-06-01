export const config = {
  runtime: "edge",
};

const CACHE_TTL_MS = 60_000;
const registryCache = new Map();
let cachePopulatedAt = 0;

async function fetchRegistry() {
  const now = Date.now();
  if (now - cachePopulatedAt < CACHE_TTL_MS && registryCache.size > 0) {
    return registryCache;
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const groupId = process.env.REGISTRY_GROUP_ID;
  const topicId = process.env.TOPIC_REGISTRY;

  if (!token || !groupId || !topicId) {
    return registryCache;
  }

  try {
    const url = `https://api.telegram.org/bot${token}/getForumTopicMessages?chat_id=${groupId}&message_thread_id=${topicId}&limit=100`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return registryCache;

    const data = await resp.json();
    if (!data.ok) return registryCache;

    const messages = data.result?.messages ?? [];
    const fresh = new Map();

    for (const msg of messages) {
      const text = msg?.text;
      if (!text) continue;
      try {
        const record = JSON.parse(text);
        if (record.app_name && record.render_url) {
          fresh.set(record.app_name, {
            render_url: record.render_url,
            status: record.status,
            expires_at: now + CACHE_TTL_MS,
          });
          fresh.set(record.subdomain, {
            render_url: record.render_url,
            status: record.status,
            expires_at: now + CACHE_TTL_MS,
          });
        }
      } catch {
        // skip non-JSON messages
      }
    }

    if (fresh.size > 0) {
      registryCache.clear();
      for (const [k, v] of fresh) registryCache.set(k, v);
      cachePopulatedAt = now;
    }
  } catch {
    // return stale cache on error
  }

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
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>404 — AirDeploy</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #0f0f0f; color: #fff; }
    .card { text-align: center; padding: 2rem; }
    h1 { font-size: 4rem; margin: 0; color: #ff4444; }
    p { color: #aaa; margin: 0.5rem 0; }
    a { color: #60a5fa; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <h1>404</h1>
    <p>App <strong>${appName || "unknown"}</strong> not found on AirDeploy.</p>
    <p>It may have been deleted or the name is incorrect.</p>
    <p><a href="https://airdeploy.xyz">← Back to AirDeploy</a></p>
  </div>
</body>
</html>`,
    {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }
  );
}

export default async function handler(request) {
  const host = request.headers.get("host") || "";
  const subdomain = extractSubdomain(host);

  if (!subdomain) {
    const orchestratorUrl = process.env.ORCHESTRATOR_URL;
    if (orchestratorUrl) {
      const proxyUrl = new URL(request.url);
      proxyUrl.host = new URL(orchestratorUrl).host;
      return fetch(new Request(proxyUrl.toString(), request));
    }
    return notFoundPage(null);
  }

  const registry = await fetchRegistry();
  const entry = registry.get(subdomain) || registry.get(`${subdomain}.${process.env.BASE_DOMAIN || "airdeploy.xyz"}`);

  if (!entry) {
    return notFoundPage(subdomain);
  }

  if (entry.status === "suspended") {
    return new Response(
      `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Suspended — AirDeploy</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #0f0f0f; color: #fff; }
    .card { text-align: center; padding: 2rem; }
    h1 { font-size: 3rem; margin: 0; color: #f59e0b; }
    p { color: #aaa; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Suspended</h1>
    <p>App <strong>${subdomain}</strong> is currently suspended (free tier spin-down).</p>
    <p>It will wake up shortly. Please try again in 30 seconds.</p>
  </div>
</body>
</html>`,
      {
        status: 503,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Retry-After": "30",
        },
      }
    );
  }

  const targetUrl = entry.render_url;
  const incomingUrl = new URL(request.url);
  const proxyUrl = new URL(incomingUrl.pathname + incomingUrl.search, targetUrl);

  const proxyRequest = new Request(proxyUrl.toString(), {
    method: request.method,
    headers: (() => {
      const h = new Headers(request.headers);
      h.set("host", new URL(targetUrl).hostname);
      h.set("x-forwarded-host", host);
      h.set("x-forwarded-for", request.headers.get("cf-connecting-ip") || "");
      return h;
    })(),
    body: ["GET", "HEAD"].includes(request.method) ? null : request.body,
    redirect: "follow",
  });

  try {
    const upstream = await fetch(proxyRequest, { signal: AbortSignal.timeout(30_000) });
    return upstream;
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Gateway error", detail: String(err) }),
      {
        status: 502,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
