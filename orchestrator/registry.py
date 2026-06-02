import json
from datetime import datetime
from typing import Optional, List, Dict
from pyrogram import Client
from pyrogram.errors import FloodWait
import asyncio
from config import (
    TELEGRAM_API_ID,
    TELEGRAM_API_HASH,
    TELEGRAM_SESSION,
    TELEGRAM_SESSION_STRING,
    REGISTRY_GROUP_ID,
    TOPIC_REGISTRY,
    TOPIC_ACCOUNTS,
    TOPIC_LOGS,
    TOPIC_HEALTH,
)

_client: Optional[Client] = None


async def get_client() -> Client:
    global _client
    if _client is None or not _client.is_connected:
        if TELEGRAM_SESSION_STRING:
            _client = Client(
                name="airdeploy",
                api_id=TELEGRAM_API_ID,
                api_hash=TELEGRAM_API_HASH,
                session_string=TELEGRAM_SESSION_STRING,
            )
        else:
            _client = Client(
                TELEGRAM_SESSION,
                api_id=TELEGRAM_API_ID,
                api_hash=TELEGRAM_API_HASH,
            )
        await _client.start()
        # String sessions don't carry the peer DB, so Pyrogram can't
        # resolve the group ID until it fetches dialogs (which returns
        # the access_hash for each chat and stores it locally).
        try:
            async for dialog in _client.get_dialogs():
                if dialog.chat.id == REGISTRY_GROUP_ID:
                    break
        except Exception:
            pass
    return _client


async def _send_message(topic_id: int, text: str) -> int:
    client = await get_client()
    for attempt in range(3):
        try:
            msg = await client.send_message(
                chat_id=REGISTRY_GROUP_ID,
                text=text,
                reply_to_message_id=topic_id,
            )
            return msg.id
        except FloodWait as e:
            await asyncio.sleep(e.value)
        except Exception:
            if attempt == 2:
                raise
            await asyncio.sleep(2)
    raise RuntimeError("Failed to send Telegram message")


async def _edit_message(message_id: int, text: str) -> None:
    client = await get_client()
    for attempt in range(3):
        try:
            await client.edit_message_text(
                chat_id=REGISTRY_GROUP_ID,
                message_id=message_id,
                text=text,
            )
            return
        except FloodWait as e:
            await asyncio.sleep(e.value)
        except Exception:
            if attempt == 2:
                raise
            await asyncio.sleep(2)


async def _delete_message(message_id: int) -> None:
    client = await get_client()
    await client.delete_messages(chat_id=REGISTRY_GROUP_ID, message_ids=message_id)


async def _get_topic_messages(topic_id: int) -> List[Dict]:
    client = await get_client()
    records = []
    async for msg in client.get_discussion_replies(
        chat_id=REGISTRY_GROUP_ID,
        message_id=topic_id,
    ):
        if msg.text:
            try:
                data = json.loads(msg.text)
                data["_message_id"] = msg.id
                records.append(data)
            except json.JSONDecodeError:
                pass
    return records


async def register_deployment(
    app_name: str,
    render_url: str,
    render_service_id: str,
    account_id: str,
    owner: str,
    runtime: str,
    cloudflare_record_id: str = "",
) -> Dict:
    from config import BASE_DOMAIN

    record = {
        "app_name": app_name,
        "subdomain": f"{app_name}.{BASE_DOMAIN}",
        "render_url": render_url,
        "render_service_id": render_service_id,
        "cloudflare_record_id": cloudflare_record_id,
        "account_id": account_id,
        "owner": owner,
        "status": "alive",
        "last_ping": datetime.utcnow().isoformat() + "Z",
        "deployed_at": datetime.utcnow().isoformat() + "Z",
        "runtime": runtime,
        "message_id": None,
    }

    text = json.dumps(record, indent=2)
    msg_id = await _send_message(TOPIC_REGISTRY, text)

    record["message_id"] = msg_id
    await _edit_message(msg_id, json.dumps(record, indent=2))

    return record


async def get_deployment(app_name: str) -> Optional[Dict]:
    records = await _get_topic_messages(TOPIC_REGISTRY)
    for record in records:
        if record.get("app_name") == app_name:
            return record
    return None


async def get_all_deployments() -> List[Dict]:
    return await _get_topic_messages(TOPIC_REGISTRY)


async def update_deployment_status(
    app_name: str, status: str, last_ping: Optional[str] = None
) -> bool:
    record = await get_deployment(app_name)
    if not record:
        return False

    msg_id = record.get("message_id") or record.get("_message_id")
    if not msg_id:
        return False

    record["status"] = status
    if last_ping:
        record["last_ping"] = last_ping
    else:
        record["last_ping"] = datetime.utcnow().isoformat() + "Z"

    record.pop("_message_id", None)
    await _edit_message(msg_id, json.dumps(record, indent=2))
    return True


async def delete_deployment(app_name: str) -> bool:
    record = await get_deployment(app_name)
    if not record:
        return False

    msg_id = record.get("message_id") or record.get("_message_id")
    if not msg_id:
        return False

    await _delete_message(msg_id)
    return True


async def log_event(message: str) -> None:
    timestamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M")
    await _send_message(TOPIC_LOGS, f"[{timestamp}] {message}")


async def get_all_accounts() -> List[Dict]:
    return await _get_topic_messages(TOPIC_ACCOUNTS)


async def register_account(
    account_id: str, api_key: str, email: str
) -> Dict:
    record = {
        "account_id": account_id,
        "api_key": api_key,
        "email": email,
        "services_count": 0,
        "status": "available",
        "message_id": None,
    }

    text = json.dumps(record, indent=2)
    msg_id = await _send_message(TOPIC_ACCOUNTS, text)

    record["message_id"] = msg_id
    await _edit_message(msg_id, json.dumps(record, indent=2))

    return record


async def update_account(account_id: str, updates: Dict) -> bool:
    accounts = await get_all_accounts()
    for account in accounts:
        if account.get("account_id") == account_id:
            msg_id = account.get("message_id") or account.get("_message_id")
            if not msg_id:
                return False

            account.update(updates)
            account.pop("_message_id", None)
            await _edit_message(msg_id, json.dumps(account, indent=2))
            return True
    return False


async def update_health_topic(summary: str) -> None:
    client = await get_client()
    records = []

    async for msg in client.get_discussion_replies(
        chat_id=REGISTRY_GROUP_ID,
        message_id=TOPIC_HEALTH,
    ):
        if msg.text and not msg.text.startswith("["):
            records.append(msg.id)

    if records:
        await _edit_message(records[0], summary)
    else:
        await _send_message(TOPIC_HEALTH, summary)
