import httpx
from typing import Dict, List
from config import CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID, CLOUDFLARE_API_BASE, BASE_DOMAIN


def _headers() -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}",
        "Content-Type": "application/json",
    }


VERCEL_CNAME = "cname.vercel-dns.com"


async def add_subdomain(subdomain: str, _render_url: str = "") -> str:
    """Create a DNS-only CNAME pointing to the Vercel gateway.
    Pointing directly at Render causes Cloudflare Error 1000 because
    Render itself runs on Cloudflare IPs."""
    payload = {
        "type": "CNAME",
        "name": subdomain,
        "content": VERCEL_CNAME,
        "ttl": 1,
        "proxied": False,
    }

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{CLOUDFLARE_API_BASE}/zones/{CLOUDFLARE_ZONE_ID}/dns_records",
            headers=_headers(),
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()

    if not data.get("success"):
        errors = data.get("errors", [])
        raise RuntimeError(f"Cloudflare DNS error: {errors}")

    return data["result"]["id"]


async def fix_to_vercel(record_id: str, subdomain: str) -> bool:
    """Update an existing DNS record to point at Vercel (DNS-only) instead of Render.
    Fixes deployments that were created before the Vercel-routing change."""
    payload = {
        "type": "CNAME",
        "name": subdomain,
        "content": VERCEL_CNAME,
        "ttl": 1,
        "proxied": False,
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.put(
            f"{CLOUDFLARE_API_BASE}/zones/{CLOUDFLARE_ZONE_ID}/dns_records/{record_id}",
            headers=_headers(),
            json=payload,
        )
        return resp.is_success


async def delete_subdomain(record_id: str) -> bool:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.delete(
            f"{CLOUDFLARE_API_BASE}/zones/{CLOUDFLARE_ZONE_ID}/dns_records/{record_id}",
            headers=_headers(),
        )
        if resp.status_code not in (200, 204):
            return False
        data = resp.json()
        return data.get("success", False)


async def list_subdomains() -> List[Dict]:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{CLOUDFLARE_API_BASE}/zones/{CLOUDFLARE_ZONE_ID}/dns_records",
            headers=_headers(),
            params={"per_page": 100},
        )
        resp.raise_for_status()
        data = resp.json()

    if not data.get("success"):
        return []

    records = data.get("result", [])
    return [r for r in records if BASE_DOMAIN in r.get("name", "")]
