from typing import Dict, Optional
import registry


class NoAccountAvailable(Exception):
    pass


async def get_available_account() -> Dict:
    accounts = await registry.get_all_accounts()
    for account in accounts:
        if account.get("status") == "available":
            return account
    raise NoAccountAvailable("No Render accounts available. Platform at capacity.")


async def mark_account_full(account_id: str) -> None:
    await registry.update_account(
        account_id,
        {"status": "full", "services_count": 1},
    )


async def mark_account_available(account_id: str) -> None:
    await registry.update_account(
        account_id,
        {"status": "available", "services_count": 0},
    )


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
