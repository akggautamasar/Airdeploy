import re
import httpx
from typing import Dict, Optional

import render_api
import cloudflare_api
import registry
import pool
from config import BASE_DOMAIN, GITHUB_API_BASE


_APP_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9\-]{1,61}[a-z0-9]$")


def _validate_app_name(app_name: str) -> None:
    if not _APP_NAME_RE.match(app_name):
        raise ValueError(
            "App name must be lowercase alphanumeric with optional hyphens, 3-63 chars."
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
) -> Dict:
    _validate_app_name(app_name)

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

        service_data = await render_api.create_service(
            api_key, repo_url, app_name, runtime, env_vars
        )
        render_service_id = service_data["service_id"]

        try:
            render_url = await render_api.wait_for_deploy(api_key, render_service_id)
        except TimeoutError:
            await render_api.delete_service(api_key, render_service_id)
            raise TimeoutError(f"Deploy of '{app_name}' timed out after 300 seconds.")

        if not render_url:
            svc = await render_api.get_service(api_key, render_service_id)
            render_url = svc.get("url", f"https://{app_name}.onrender.com")

        try:
            subdomain = f"{app_name}.{BASE_DOMAIN}"
            cloudflare_record_id = await cloudflare_api.add_subdomain(subdomain, render_url)
        except Exception as cf_err:
            await render_api.delete_service(api_key, render_service_id)
            raise RuntimeError(f"Cloudflare DNS failed: {cf_err}")

        record = await registry.register_deployment(
            app_name=app_name,
            render_url=render_url,
            render_service_id=render_service_id,
            account_id=account_id,
            owner=owner,
            runtime=runtime,
            cloudflare_record_id=cloudflare_record_id,
        )

        await pool.mark_account_full(account_id)
        await registry.log_event(
            f"DEPLOY success: {app_name} → {render_url} (owner: {owner})"
        )

        return {
            "subdomain": f"{app_name}.{BASE_DOMAIN}",
            "render_url": render_url,
            "service_id": render_service_id,
            "status": "alive",
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
