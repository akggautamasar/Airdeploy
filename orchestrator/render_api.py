import httpx
import asyncio
from typing import Dict, List, Optional
from config import RENDER_API_BASE


_RUNTIME_COMMANDS = {
    "node": {
        "buildCommand": "npm install",
        "startCommand": "npm start",
        "runtime": "node",
    },
    "python": {
        "buildCommand": "pip install -r requirements.txt",
        "startCommand": "uvicorn main:app --host 0.0.0.0 --port $PORT",
        "runtime": "python",
    },
    "static": {
        "buildCommand": "",
        "startCommand": "",
        "runtime": "static",
    },
}


def _headers(api_key: str) -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


async def create_service(
    api_key: str,
    repo_url: str,
    app_name: str,
    runtime: str,
    env_vars: Dict[str, str] = {},
) -> Dict:
    cmds = _RUNTIME_COMMANDS.get(runtime, _RUNTIME_COMMANDS["node"])

    env_list = [{"key": k, "value": v} for k, v in env_vars.items()]

    payload = {
        "type": "web_service",
        "name": app_name,
        "repo": repo_url,
        "branch": "main",
        "plan": "free",
        "region": "oregon",
        "runtime": cmds["runtime"],
        "buildCommand": cmds["buildCommand"],
        "startCommand": cmds["startCommand"],
        "envVars": env_list,
        "autoDeploy": "no",
    }

    if runtime == "static":
        payload.pop("startCommand")
        payload["type"] = "static_site"

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{RENDER_API_BASE}/services",
            headers=_headers(api_key),
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()

    service = data.get("service", data)
    service_id = service.get("id", "")
    render_url = service.get("serviceDetails", {}).get("url", "") or service.get("url", "")

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
    status = service.get("serviceDetails", {}).get("status", service.get("status", "unknown"))
    url = service.get("serviceDetails", {}).get("url", service.get("url", ""))
    return {"status": status, "url": url, "raw": service}


async def delete_service(api_key: str, service_id: str) -> bool:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.delete(
            f"{RENDER_API_BASE}/services/{service_id}",
            headers=_headers(api_key),
        )
        return resp.status_code in (200, 204)


async def get_logs(api_key: str, service_id: str) -> str:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{RENDER_API_BASE}/services/{service_id}/logs",
            headers=_headers(api_key),
        )
        if resp.status_code != 200:
            return f"Could not fetch logs (HTTP {resp.status_code})"
        data = resp.json()

    if isinstance(data, list):
        return "\n".join(
            f"[{entry.get('timestamp', '')}] {entry.get('message', '')}"
            for entry in data
        )
    return str(data)


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
