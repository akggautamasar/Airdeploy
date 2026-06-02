export default async function handler(request) {
  // Auth is optional — if CRON_SECRET is set, enforce it; otherwise allow all
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization") || "";
    const tokenParam = new URL(request.url).searchParams.get("token") || "";
    if (authHeader !== `Bearer ${cronSecret}` && tokenParam !== cronSecret) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  const orchestratorUrl = process.env.ORCHESTRATOR_URL;
  const orchestratorSecret = process.env.ORCHESTRATOR_SECRET;

  if (!orchestratorUrl) {
    return new Response(
      JSON.stringify({ error: "ORCHESTRATOR_URL not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let deployments = [];
  try {
    const resp = await fetch(`${orchestratorUrl}/deployments`, {
      headers: { "X-Secret": orchestratorSecret || "" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) throw new Error(`Orchestrator returned ${resp.status}`);
    deployments = await resp.json();
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to fetch deployments", detail: String(err) }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  const active = deployments.filter((d) => d.status !== "suspended_permanent");

  const pingResults = await Promise.allSettled(
    active.map(async (deployment) => {
      const { app_name, render_url } = deployment;
      try {
        const start = Date.now();
        const resp = await fetch(`${render_url}/`, {
          method: "GET",
          redirect: "follow",
          signal: AbortSignal.timeout(15_000),
        });
        const latency = Date.now() - start;
        const alive = resp.status < 500;
        return { app_name, render_url, alive, status_code: resp.status, latency_ms: latency };
      } catch (err) {
        return { app_name, render_url, alive: false, error: String(err) };
      }
    })
  );

  const results = pingResults.map((r) =>
    r.status === "fulfilled" ? r.value : { alive: false, error: r.reason?.message }
  );

  try {
    await fetch(`${orchestratorUrl}/health/update`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Secret": orchestratorSecret || "",
      },
      body: JSON.stringify({ results }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // best-effort
  }

  const alive = results.filter((r) => r.alive).length;
  const summary = {
    checked: results.length,
    alive,
    dead: results.length - alive,
    timestamp: new Date().toISOString(),
    results,
  };

  return new Response(JSON.stringify(summary, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
