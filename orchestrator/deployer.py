import re
import httpx
from typing import Dict, Optional

import render_api
import cloudflare_api
import vercel_api
import registry
import pool
from config import BASE_DOMAIN, GITHUB_API_BASE


_APP_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9\-]{1,61}[a-z0-9]$")
_GITHUB_REPO_RE = re.compile(r"github\.com/[^/]+/[^/]+")


def _validate_app_name(app_name: str) -> None:
    if not _APP_NAME_RE.match(app_name):
        raise ValueError(
            "App name must be lowercase alphanumeric with optional hyphens, 3-63 chars."
        )


def _validate_repo_url(repo_url: str) -> None:
    if not _GITHUB_REPO_RE.search(repo_url):
        raise ValueError(
            "Invalid repo URL. Must be a full GitHub repo URL like: "
            "https://github.com/username/repository-name"
        )


async def _detect_runtime(repo_url: str) -> str:
    match = re.search(r"github\.com/([^/]+/[^/]+?)(?:\.git)?$", repo_url)
    if not match:
        return "node"

    repo_path = match.group(1).rstrip("/")

    async with httpx.AsyncClient(timeout=15) as client:
        try:
            resp = await client.get(
                f"{GITHUB_API_BASE}/repos/{repo_path}/contents/",
                headers={"Accept": "application/vnd.github.v3+json"},
            )
            if resp.status_code != 200:
                return "node"
            files = {item["name"] for item in resp.json()}
        except Exception:
            return "node"

    if "Procfile" in files:
        try:
            procfile_resp = await client.get(
                f"{GITHUB_API_BASE}/repos/{repo_path}/contents/Procfile",
                headers={"Accept": "application/vnd.github.v3+json"},
            )
            if procfile_resp.status_code == 200:
                import base64
                content = base64.b64decode(procfile_resp.json().get("content", "")).decode()
                if "python" in content.lower() or "uvicorn" in content.lower() or "gunicorn" in content.lower():
                    return "python"
                if "node" in content.lower():
                    return "node"
        except Exception:
            pass

    if "requirements.txt" in files:
        return "python"
    if "package.json" in files:
        return "node"
    if "index.html" in files:
        return "static"

    return "node"


async def deploy(
    repo_url: str,
    app_name: str,
    runtime: Optional[str],
    owner: str,
    env_vars: Dict[str, str] = {},
    branch: str = "main",
    region: str = "oregon",
    root_dir: str = "",
    build_command: str = "",
    start_command: str = "",
) -> Dict:
    _validate_app_name(app_name)
    _validate_repo_url(repo_url)

    existing = await registry.get_deployment(app_name)
    if existing:
        raise ValueError(f"App name '{app_name}' is already taken.")

    if not runtime:
        runtime = await _detect_runtime(repo_url)

    account = await pool.get_available_account()
    account_id = account["account_id"]
    api_key = account["api_key"]

    render_service_id = None
    cloudflare_record_id = None

    try:
        await registry.log_event(f"DEPLOY started: {app_name} by {owner}")

        # 1. Create the Render service
        service_data = await render_api.create_service(
            api_key, repo_url, app_name, runtime, env_vars,
            branch=branch, region=region, root_dir=root_dir,
            build_command=build_command, start_command=start_command,
        )
        render_service_id = service_data["service_id"]
        render_url = service_data.get("render_url") or f"https://{app_name}.onrender.com"

        # 2. Add DNS + Vercel domain so traffic routes correctly.
        #    CNAME points to Vercel gateway (not Render) to avoid Cloudflare
        #    Error 1000 (Render runs on Cloudflare IPs).
        #    Vercel gateway then proxies to the Render URL.
        subdomain = f"{app_name}.{BASE_DOMAIN}"
        try:
            cloudflare_record_id = await cloudflare_api.add_subdomain(subdomain)
        except Exception as cf_err:
            await render_api.delete_service(api_key, render_service_id)
            raise RuntimeError(f"Cloudflare DNS failed: {cf_err}")

        try:
            await vercel_api.add_domain(subdomain)
        except Exception as ve:
            # Non-fatal: Vercel token may not be set yet, or domain already exists.
            await registry.log_event(f"WARN: Vercel domain add skipped for {subdomain}: {ve}")

        # 3. Register in Telegram with status="deploying" so the name is tracked
        #    even if the wait-for-live step times out.
        await registry.register_deployment(
            app_name=app_name,
            render_url=render_url,
            render_service_id=render_service_id,
            account_id=account_id,
            owner=owner,
            runtime=runtime,
            repo_url=repo_url,
            cloudflare_record_id=cloudflare_record_id,
            status="deploying",
        )
        # account already incremented inside pool.get_available_account

        # 4. Wait for Render to finish building (up to 10 min).
        #    On timeout, leave status as "deploying" — the keepalive cron will
        #    flip it to "alive" once the service responds.
        try:
            live_url = await render_api.wait_for_deploy(api_key, render_service_id, timeout=600)
            # Re-fetch to get the canonical URL Render assigned
            try:
                svc = await render_api.get_service(api_key, render_service_id)
                actual_url = svc.get("url", "").strip() or live_url or render_url
            except Exception:
                actual_url = live_url or render_url
            await registry.update_deployment_status(app_name, "alive")
            await registry.log_event(
                f"DEPLOY success: {app_name} → {actual_url} (owner: {owner})"
            )
            return {
                "subdomain": f"{app_name}.{BASE_DOMAIN}",
                "render_url": actual_url,
                "service_id": render_service_id,
                "status": "alive",
            }
        except TimeoutError:
            # Service is registered; keepalive will mark alive once it's up.
            await registry.log_event(
                f"DEPLOY building: {app_name} still starting after 10 min, "
                f"keepalive will mark alive when ready"
            )
            return {
                "subdomain": f"{app_name}.{BASE_DOMAIN}",
                "render_url": render_url,
                "service_id": render_service_id,
                "status": "deploying",
            }

    except Exception as exc:
        await registry.log_event(f"DEPLOY failed: {app_name} — {exc}")
        raise


async def undeploy(app_name: str, owner: str) -> None:
    record = await registry.get_deployment(app_name)
    if not record:
        raise ValueError(f"App '{app_name}' not found.")

    if record.get("owner") != owner:
        raise PermissionError(f"You do not own app '{app_name}'.")

    account_id = record["account_id"]
    render_service_id = record["render_service_id"]
    cloudflare_record_id = record.get("cloudflare_record_id", "")

    accounts = await registry.get_all_accounts()
    api_key = None
    for acc in accounts:
        if acc.get("account_id") == account_id:
            api_key = acc["api_key"]
            break

    if api_key:
        await render_api.delete_service(api_key, render_service_id)

    if cloudflare_record_id:
        await cloudflare_api.delete_subdomain(cloudflare_record_id)

    subdomain = f"{app_name}.{BASE_DOMAIN}"
    await vercel_api.remove_domain(subdomain)

    await registry.delete_deployment(app_name)
    await pool.mark_account_available(account_id)
    await registry.log_event(f"UNDEPLOY: {app_name} by {owner}")


async def redeploy(app_name: str, owner: str) -> None:
    record = await registry.get_deployment(app_name)
    if not record:
        raise ValueError(f"App '{app_name}' not found.")

    if record.get("owner") != owner:
        raise PermissionError(f"You do not own app '{app_name}'.")

    account_id = record["account_id"]
    render_service_id = record["render_service_id"]

    accounts = await registry.get_all_accounts()
    api_key = None
    for acc in accounts:
        if acc.get("account_id") == account_id:
            api_key = acc["api_key"]
            break

    if not api_key:
        raise RuntimeError(f"Account '{account_id}' not found.")

    await render_api.trigger_redeploy(api_key, render_service_id)
    await registry.log_event(f"REDEPLOY triggered: {app_name} by {owner}")


async def migrate(app_name: str) -> Dict:
    """Move a suspended/dead service to a fresh Render account automatically.
    Called by the keepalive cron when a service fails 3+ consecutive health checks.
    Requires repo_url to be stored in the deployment record."""
    record = await registry.get_deployment(app_name)
    if not record:
        raise ValueError(f"App '{app_name}' not found.")

    repo_url = record.get("repo_url", "")
    if not repo_url:
        raise RuntimeError(f"Cannot migrate '{app_name}': repo_url not stored in registry.")

    runtime = record.get("runtime", "node")
    owner = record.get("owner", "")
    old_account_id = record["account_id"]
    old_render_service_id = record["render_service_id"]
    old_cloudflare_record_id = record.get("cloudflare_record_id", "")

    await registry.log_event(f"MIGRATE started: {app_name} (old account: {old_account_id})")

    # Pick a different account
    new_account = await pool.get_available_account()
    if new_account["account_id"] == old_account_id:
        # If it's the same account (only one available), still try
        pass
    new_account_id = new_account["account_id"]
    new_api_key = new_account["api_key"]

    # Create new Render service on new account
    service_data = await render_api.create_service(
        new_api_key, repo_url, app_name, runtime, {}
    )
    new_service_id = service_data["service_id"]
    new_render_url = service_data.get("render_url") or f"https://{app_name}.onrender.com"

    # Update the DNS/Cloudflare record to point to new Render URL if needed
    # (CNAME still points to Vercel, which reads render_url from registry, so just update registry)

    # Update the registry record with new service info
    msg_id = record.get("message_id") or record.get("_message_id")
    if msg_id:
        record["render_service_id"] = new_service_id
        record["render_url"] = new_render_url
        record["account_id"] = new_account_id
        record["status"] = "deploying"
        record["fail_count"] = 0
        record.pop("_message_id", None)
        await registry._edit_message(msg_id, __import__("json").dumps(record, indent=2))

    # Clean up old service
    accounts = await registry.get_all_accounts()
    old_api_key = next((a["api_key"] for a in accounts if a.get("account_id") == old_account_id), None)
    if old_api_key:
        try:
            await render_api.delete_service(old_api_key, old_render_service_id)
        except Exception:
            pass

    # new_account already incremented inside pool.get_available_account
    await pool.decrement_account(old_account_id)

    await registry.log_event(
        f"MIGRATE success: {app_name} moved from {old_account_id} → {new_account_id}"
    )
    return {"app_name": app_name, "new_account": new_account_id, "new_render_url": new_render_url}
