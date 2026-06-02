import httpx
from config import VERCEL_TOKEN, VERCEL_PROJECT_ID, VERCEL_TEAM_ID

VERCEL_API_BASE = "https://api.vercel.com"


def _headers():
    return {
        "Authorization": f"Bearer {VERCEL_TOKEN}",
        "Content-Type": "application/json",
    }


def _params():
    return {"teamId": VERCEL_TEAM_ID} if VERCEL_TEAM_ID else {}


async def add_domain(subdomain: str) -> None:
    if not VERCEL_TOKEN or not VERCEL_PROJECT_ID:
        return
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{VERCEL_API_BASE}/v10/projects/{VERCEL_PROJECT_ID}/domains",
            headers=_headers(),
            params=_params(),
            json={"name": subdomain},
        )
        # 409 = already added, that's fine
        if resp.status_code not in (200, 201, 409):
            raise RuntimeError(f"Vercel domain API {resp.status_code}: {resp.text[:200]}")


async def remove_domain(subdomain: str) -> bool:
    if not VERCEL_TOKEN or not VERCEL_PROJECT_ID:
        return True
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.delete(
            f"{VERCEL_API_BASE}/v10/projects/{VERCEL_PROJECT_ID}/domains/{subdomain}",
            headers=_headers(),
            params=_params(),
        )
        return resp.status_code in (200, 204)
