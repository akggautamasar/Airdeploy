import httpx
import asyncio
from typing import Dict, List, Optional
from config import RENDER_API_BASE


def _headers(api_key: str) -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


async def get_owner_id(api_key: str) -> str:
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{RENDER_API_BASE}/owners?limit=1",
                headers=_headers(api_key),
            )
            resp.raise_for_status()
            data = resp.json()
        if isinstance(data, list) and data:
            item = data[0]
            # Response is [{owner: {id, ...}, cursor: ...}] or [{id, ...}]
            owner = item.get("owner", item)
            return owner.get("id", "")
    except Exception:
        pass
    return ""


async def create_service(
    api_key: str,
    repo_url: str,
    app_name: str,
    runtime: str,
    env_vars: Dict[str, str] = {},
    branch: str = "main",
    region: str = "oregon",
    root_dir: str = "",
    build_command: str = "",
    start_command: str = "",
) -> Dict:
    owner_id = await get_owner_id(api_key)

    env_list = [{"key": k, "value": v} for k, v in env_vars.items()]

    if runtime == "static":
        details: Dict = {
            "buildCommand": build_command or "",
            "publishPath": root_dir or "./",
            "pullRequestPreviewsEnabled": "no",
        }
        payload = {
            "type": "static_site",
            "name": app_name,
            "repo": repo_url,
            "branch": branch,
            "autoDeploy": "no",
            "serviceDetails": details,
            "envVars": env_list,
        }
    elif runtime == "python":
        details = {
            "env": "python",
            "plan": "free",
            "region": region,
            "pullRequestPreviewsEnabled": "no",
            "envSpecificDetails": {
                "buildCommand": build_command or "pip install -r requirements.txt",
                "startCommand": start_command or "uvicorn main:app --host 0.0.0.0 --port $PORT",
            },
        }
        if root_dir:
            details["rootDir"] = root_dir
        payload = {
            "type": "web_service",
            "name": app_name,
            "repo": repo_url,
            "branch": branch,
            "autoDeploy": "no",
            "serviceDetails": details,
            "envVars": env_list,
        }
    else:
        # node (default)
        details = {
            "env": "node",
            "plan": "free",
            "region": region,
            "pullRequestPreviewsEnabled": "no",
            "envSpecificDetails": {
                "buildCommand": build_command or "npm install",
                "startCommand": start_command or "npm start",
            },
        }
        if root_dir:
            details["rootDir"] = root_dir
        payload = {
            "type": "web_service",
            "name": app_name,
            "repo": repo_url,
            "branch": branch,
            "autoDeploy": "no",
            "serviceDetails": details,
            "envVars": env_list,
        }

    if owner_id:
        payload["ownerId"] = owner_id

    import json as _json
    print(f"[RENDER] POST /services payload: {_json.dumps(payload)}")

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{RENDER_API_BASE}/services",
            headers=_headers(api_key),
            json=payload,
        )
        print(f"[RENDER] Response {resp.status_code}: {resp.text[:500]}")
        if not resp.is_success:
            raise RuntimeError(
                f"Render API {resp.status_code}: {resp.text}"
            )
        data = resp.json()

    service = data.get("service", data)
    service_id = service.get("id", "")
    render_url = (
        service.get("serviceDetails", {}).get("url", "")
        or service.get("url", "")
        or f"https://{app_name}.onrender.com"
    )

    return {"service_id": service_id, "render_url": render_url, "raw": service}


async def get_service(api_key: str, service_id: str) -> Dict:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{RENDER_API_BASE}/services/{service_id}",
            headers=_headers(api_key),
        )
        resp.raise_for_status()
        data = resp.json()

    service = data.get("service", data)
    details = service.get("serviceDetails", {})
    status = details.get("status", service.get("status", "unknown"))
    url = details.get("url", service.get("url", ""))
    return {"status": status, "url": url, "raw": service}


async def delete_service(api_key: str, service_id: str) -> bool:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.delete(
            f"{RENDER_API_BASE}/services/{service_id}",
            headers=_headers(api_key),
        )
        return resp.status_code in (200, 204)


async def get_logs(api_key: str, service_id: str, limit: int = 200) -> str:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{RENDER_API_BASE}/services/{service_id}/logs",
            headers=_headers(api_key),
            params={"limit": limit, "direction": "backward"},
        )
        if resp.status_code != 200:
            return f"Could not fetch logs (HTTP {resp.status_code}): {resp.text[:200]}"
        data = resp.json()

    if isinstance(data, list):
        lines = [
            f"[{e.get('timestamp', '')}] {e.get('message', '')}"
            for e in reversed(data)
        ]
        return "\n".join(lines)
    return str(data)


async def get_deploys(api_key: str, service_id: str) -> List[Dict]:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{RENDER_API_BASE}/services/{service_id}/deploys",
            headers=_headers(api_key),
            params={"limit": 10},
        )
        if not resp.is_success:
            return []
        data = resp.json()
    return [item.get("deploy", item) for item in data] if isinstance(data, list) else []


async def get_env_vars(api_key: str, service_id: str) -> List[Dict]:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{RENDER_API_BASE}/services/{service_id}/env-vars",
            headers=_headers(api_key),
        )
        if not resp.is_success:
            return []
        data = resp.json()
    return [item.get("envVar", item) for item in data] if isinstance(data, list) else []


async def update_env_vars(api_key: str, service_id: str, env_vars: List[Dict]) -> None:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.put(
            f"{RENDER_API_BASE}/services/{service_id}/env-vars",
            headers=_headers(api_key),
            json=env_vars,
        )
        if not resp.is_success:
            raise RuntimeError(f"Render API {resp.status_code}: {resp.text}")


async def update_service(api_key: str, service_id: str, patch: Dict) -> Dict:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.patch(
            f"{RENDER_API_BASE}/services/{service_id}",
            headers=_headers(api_key),
            json=patch,
        )
        if not resp.is_success:
            raise RuntimeError(f"Render API {resp.status_code}: {resp.text}")
        return resp.json()


async def list_services(api_key: str) -> List[Dict]:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{RENDER_API_BASE}/services",
            headers=_headers(api_key),
        )
        resp.raise_for_status()
        data = resp.json()

    if isinstance(data, list):
        return [item.get("service", item) for item in data]
    return data.get("services", [])


async def trigger_redeploy(api_key: str, service_id: str) -> Dict:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{RENDER_API_BASE}/services/{service_id}/deploys",
            headers=_headers(api_key),
            json={},
        )
        resp.raise_for_status()
        return resp.json()


async def wait_for_deploy(api_key: str, service_id: str, timeout: int = 300) -> str:
    elapsed = 0
    interval = 10

    while elapsed < timeout:
        await asyncio.sleep(interval)
        elapsed += interval

        try:
            info = await get_service(api_key, service_id)
            status = info["status"]

            if status in ("live", "available", "running"):
                return info.get("url", "")
            if status in ("build_failed", "update_failed", "deactivated"):
                raise RuntimeError(f"Render deploy failed with status: {status}")
        except httpx.HTTPStatusError:
            pass

    raise TimeoutError(f"Deploy did not become live within {timeout}s")
