import os
import asyncio
from typing import Dict, Optional, List
import registry

MAX_SERVICES_PER_ACCOUNT = int(os.getenv("MAX_SERVICES_PER_ACCOUNT", "5"))

_selection_lock = asyncio.Lock()


class NoAccountAvailable(Exception):
    pass


async def get_available_account() -> Dict:
    async with _selection_lock:
        accounts = await registry.get_all_accounts()
        available = [a for a in accounts if a.get("status") == "available"]
        if not available:
            raise NoAccountAvailable("No Render accounts available. Platform at capacity.")
        # Pick least-loaded; immediately reserve the slot under the lock so
        # concurrent migrations/deploys don't both land on the same account.
        chosen = min(available, key=lambda a: a.get("services_count", 0))
        await increment_account(chosen["account_id"])
        return chosen


async def increment_account(account_id: str) -> None:
    accounts = await registry.get_all_accounts()
    for acc in accounts:
        if acc.get("account_id") == account_id:
            count = acc.get("services_count", 0) + 1
            status = "full" if count >= MAX_SERVICES_PER_ACCOUNT else "available"
            await registry.update_account(account_id, {"services_count": count, "status": status})
            return


async def decrement_account(account_id: str) -> None:
    accounts = await registry.get_all_accounts()
    for acc in accounts:
        if acc.get("account_id") == account_id:
            count = max(0, acc.get("services_count", 1) - 1)
            status = "full" if count >= MAX_SERVICES_PER_ACCOUNT else "available"
            await registry.update_account(account_id, {"services_count": count, "status": status})
            return


# Keep old names as aliases so existing call sites still work
async def mark_account_full(account_id: str) -> None:
    await increment_account(account_id)


async def mark_account_available(account_id: str) -> None:
    await decrement_account(account_id)


async def add_account(api_key: str, email: str) -> str:
    accounts = await registry.get_all_accounts()
    next_num = len(accounts) + 1
    account_id = f"acc_{next_num:02d}"

    existing_ids = {a.get("account_id") for a in accounts}
    while account_id in existing_ids:
        next_num += 1
        account_id = f"acc_{next_num:02d}"

    await registry.register_account(account_id, api_key, email)
    return account_id


async def get_all_accounts() -> list:
    return await registry.get_all_accounts()
