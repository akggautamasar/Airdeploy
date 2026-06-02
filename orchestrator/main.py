from fastapi import FastAPI, HTTPException, Header, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional, List
from datetime import datetime
import json
import asyncio

import deployer
import pool
import registry
import render_api
import vercel_api
from pool import NoAccountAvailable
from models import (
    DeployRequest,
    UndeployRequest,
    RedeployRequest,
    AddAccountRequest,
    UpdateAccountRequest,
    UpdateEnvRequest,
    UpdateSettingsRequest,
    DeployResponse,
    HealthResponse,
    HealthUpdateRequest,
)
from config import ORCHESTRATOR_SECRET

app = FastAPI(title="AirDeploy Orchestrator", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {
        "name": "AirDeploy Orchestrator",
        "version": "1.0.0",
        "status": "running",
        "docs": "/docs",
        "health": "/health",
    }


async def verify_secret(x_secret: Optional[str] = Header(None)):
    if not ORCHESTRATOR_SECRET:
        return
    if x_secret != ORCHESTRATOR_SECRET:
        raise HTTPException(status_code=401, detail="Invalid or missing X-Secret header")


@app.get("/health")
async def health():
    try:
        accounts = await registry.get_all_accounts()
        deployments = await registry.get_all_deployments()
        available = sum(1 for a in accounts if a.get("status") == "available")
        alive = sum(1 for d in deployments if d.get("status") == "alive")
        return HealthResponse(
            total_accounts=len(accounts),
            available_accounts=available,
            total_deployments=len(deployments),
            alive_deployments=alive,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/deploy", dependencies=[Depends(verify_secret)])
async def deploy_app(req: DeployRequest, background_tasks: BackgroundTasks):
    # Validate eagerly so errors surface immediately
    import re
    if not re.match(r"^[a-z0-9][a-z0-9\-]{1,61}[a-z0-9]$", req.app_name):
        raise HTTPException(status_code=422, detail="Invalid app name.")
    if not re.search(r"github\.com/[^/]+/[^/]+", req.repo_url):
        raise HTTPException(status_code=422, detail="Invalid repo URL. Use: https://github.com/user/repo")

    existing = await registry.get_deployment(req.app_name)
    if existing:
        raise HTTPException(status_code=409, detail=f"App name '{req.app_name}' is already taken.")

    try:
        accounts = await registry.get_all_accounts()
        if not any(a.get("status") == "available" for a in accounts):
            raise HTTPException(status_code=503, detail="No accounts available. Platform at capacity.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Start deploy in background — returns immediately so browser doesn't timeout
    async def run_deploy():
        try:
            await deployer.deploy(
                repo_url=req.repo_url,
                app_name=req.app_name,
                runtime=req.runtime.value if req.runtime else None,
                owner=req.owner,
                env_vars=req.env_vars,
                branch=req.branch,
                region=req.region,
                root_dir=req.root_dir,
                build_command=req.build_command,
                start_command=req.start_command,
            )
        except Exception as e:
            await registry.log_event(f"DEPLOY error: {req.app_name} — {e}")
            # Store error status so frontend poll can surface it
            try:
                await registry.update_deployment_status(req.app_name, "error")
            except Exception:
                pass

    background_tasks.add_task(run_deploy)

    return {
        "app_name": req.app_name,
        "status": "deploying",
        "message": "Deploy started. Poll GET /deployment/{app_name} for status.",
        "poll_url": f"/deployment/{req.app_name}",
    }


@app.delete("/undeploy/{app_name}", dependencies=[Depends(verify_secret)])
async def undeploy_app(app_name: str, req: UndeployRequest):
    try:
        await deployer.undeploy(app_name, req.owner)
        return {"success": True}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/redeploy/{app_name}", dependencies=[Depends(verify_secret)])
async def redeploy_app(app_name: str, req: RedeployRequest):
    try:
        await deployer.redeploy(app_name, req.owner)
        return {"success": True}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/deployment/{app_name}", dependencies=[Depends(verify_secret)])
async def get_deployment(app_name: str):
    record = await registry.get_deployment(app_name)
    if not record:
        raise HTTPException(status_code=404, detail=f"App '{app_name}' not found")
    record.pop("_message_id", None)
    return record


@app.get("/deployments", dependencies=[Depends(verify_secret)])
async def list_deployments():
    records = await registry.get_all_deployments()
    for r in records:
        r.pop("_message_id", None)
    return records


@app.get("/accounts", dependencies=[Depends(verify_secret)])
async def list_accounts():
    accounts = await registry.get_all_accounts()
    masked = []
    for acc in accounts:
        acc_copy = {**acc}
        acc_copy.pop("_message_id", None)
        if "api_key" in acc_copy:
            key = acc_copy["api_key"]
            acc_copy["api_key"] = key[:6] + "****" + key[-4:] if len(key) > 10 else "****"
        masked.append(acc_copy)
    return masked


@app.post("/accounts", dependencies=[Depends(verify_secret)])
async def add_account(req: AddAccountRequest):
    try:
        account_id = await pool.add_account(req.api_key, req.email)
        return {"account_id": account_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.patch("/accounts/{account_id}", dependencies=[Depends(verify_secret)])
async def update_account(account_id: str, req: UpdateAccountRequest):
    """Update an account's status and/or services_count."""
    changes = {k: v for k, v in req.model_dump().items() if v is not None}
    if not changes:
        raise HTTPException(status_code=400, detail="No fields provided to update")
    ok = await registry.update_account(account_id, changes)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Account '{account_id}' not found")
    return {"updated": True, "account_id": account_id, "changes": changes}


@app.delete("/accounts/{account_id}", dependencies=[Depends(verify_secret)])
async def delete_account(account_id: str):
    """Remove an account from the pool (e.g. to clean up duplicates)."""
    accounts = await registry.get_all_accounts()
    target = next((a for a in accounts if a.get("account_id") == account_id), None)
    if not target:
        raise HTTPException(status_code=404, detail=f"Account '{account_id}' not found")
    msg_id = target.get("message_id") or target.get("_message_id")
    if not msg_id:
        raise HTTPException(status_code=500, detail="Cannot determine message ID")
    await registry._delete_message(msg_id)
    return {"deleted": True, "account_id": account_id}


@app.get("/logs/{app_name}", dependencies=[Depends(verify_secret)])
async def get_logs(app_name: str):
    record = await registry.get_deployment(app_name)
    if not record:
        raise HTTPException(status_code=404, detail=f"App '{app_name}' not found")

    account_id = record["account_id"]
    render_service_id = record["render_service_id"]

    accounts = await registry.get_all_accounts()
    api_key = None
    for acc in accounts:
        if acc.get("account_id") == account_id:
            api_key = acc["api_key"]
            break

    if not api_key:
        raise HTTPException(status_code=500, detail="Render account not found")

    logs = await render_api.get_logs(api_key, render_service_id)
    return {"logs": logs}


async def _get_api_key_for_app(app_name: str):
    record = await registry.get_deployment(app_name)
    if not record:
        raise HTTPException(status_code=404, detail=f"App '{app_name}' not found")
    accounts = await registry.get_all_accounts()
    api_key = next(
        (a["api_key"] for a in accounts if a.get("account_id") == record["account_id"]),
        None,
    )
    if not api_key:
        raise HTTPException(status_code=500, detail="Render account not found")
    return record, api_key


@app.get("/deployment/{app_name}/deploys", dependencies=[Depends(verify_secret)])
async def get_deploy_history(app_name: str):
    record, api_key = await _get_api_key_for_app(app_name)
    deploys = await render_api.get_deploys(api_key, record["render_service_id"])
    return {"deploys": deploys}


@app.get("/deployment/{app_name}/env", dependencies=[Depends(verify_secret)])
async def get_env(app_name: str):
    record, api_key = await _get_api_key_for_app(app_name)
    env_vars = await render_api.get_env_vars(api_key, record["render_service_id"])
    return {"env_vars": env_vars}


@app.put("/deployment/{app_name}/env", dependencies=[Depends(verify_secret)])
async def update_env(app_name: str, req: UpdateEnvRequest):
    record, api_key = await _get_api_key_for_app(app_name)
    env_list = [{"key": k, "value": v} for k, v in req.env_vars.items()]
    await render_api.update_env_vars(api_key, record["render_service_id"], env_list)
    await render_api.trigger_redeploy(api_key, record["render_service_id"])
    await registry.log_event(f"ENV UPDATED + REDEPLOY: {app_name}")
    return {"updated": True}


@app.put("/deployment/{app_name}/settings", dependencies=[Depends(verify_secret)])
async def update_settings(app_name: str, req: UpdateSettingsRequest):
    record, api_key = await _get_api_key_for_app(app_name)
    changes = {k: v for k, v in req.model_dump().items() if v is not None}
    if not changes:
        raise HTTPException(status_code=400, detail="No fields provided")
    patch: dict = {}
    if "branch" in changes:
        patch["branch"] = changes["branch"]
    if "repo_url" in changes:
        patch["repo"] = changes["repo_url"]
    env_spec = {}
    if "build_command" in changes:
        env_spec["buildCommand"] = changes["build_command"]
    if "start_command" in changes:
        env_spec["startCommand"] = changes["start_command"]
    if env_spec:
        patch["serviceDetails"] = {"envSpecificDetails": env_spec}
    await render_api.update_service(api_key, record["render_service_id"], patch)
    # Keep registry in sync if repo_url changed
    if "repo_url" in changes:
        msg_id = record.get("message_id") or record.get("_message_id")
        if msg_id:
            record["repo_url"] = changes["repo_url"]
            record.pop("_message_id", None)
            import json as _json
            await registry._edit_message(msg_id, _json.dumps(record, indent=2))
    await registry.log_event(f"SETTINGS UPDATED: {app_name} — {changes}")
    return {"updated": True}


@app.post("/fix-dns/{app_name}", dependencies=[Depends(verify_secret)])
async def fix_dns(app_name: str):
    """Fix routing for an existing deployment that was created before the
    Vercel-gateway routing change (its CNAME pointed to Render directly,
    causing Cloudflare Error 1000). Updates the CNAME to point at Vercel
    and adds the subdomain to the Vercel gateway project."""
    record = await registry.get_deployment(app_name)
    if not record:
        raise HTTPException(status_code=404, detail=f"App '{app_name}' not found")

    from config import BASE_DOMAIN
    subdomain = f"{app_name}.{BASE_DOMAIN}"
    cf_record_id = record.get("cloudflare_record_id", "")

    cf_fixed = False
    if cf_record_id:
        cf_fixed = await cloudflare_api.fix_to_vercel(cf_record_id, subdomain)

    try:
        import vercel_api as _vercel
        await _vercel.add_domain(subdomain)
        vercel_fixed = True
    except Exception as e:
        vercel_fixed = False
        await registry.log_event(f"WARN: Vercel domain add failed in fix-dns for {subdomain}: {e}")

    return {
        "subdomain": subdomain,
        "cloudflare_updated": cf_fixed,
        "vercel_domain_added": vercel_fixed,
    }


async def _do_migrate(app_name: str):
    try:
        await deployer.migrate(app_name)
    except Exception as e:
        await registry.log_event(f"AUTO-MIGRATE failed: {app_name} — {e}")


@app.post("/migrate/{app_name}", dependencies=[Depends(verify_secret)])
async def migrate_app(app_name: str, background_tasks: BackgroundTasks):
    """Move a service to a fresh Render account. Called automatically when
    a service fails 3+ consecutive keepalive checks."""
    existing = await registry.get_deployment(app_name)
    if not existing:
        raise HTTPException(status_code=404, detail=f"App '{app_name}' not found")

    async def run_migrate():
        try:
            await deployer.migrate(app_name)
        except Exception as e:
            await registry.log_event(f"MIGRATE failed: {app_name} — {e}")

    background_tasks.add_task(run_migrate)
    return {"app_name": app_name, "status": "migrating"}


@app.post("/health/update", dependencies=[Depends(verify_secret)])
async def update_health(req: HealthUpdateRequest, background_tasks: BackgroundTasks):
    results = req.results
    alive_count = sum(1 for r in results if r.get("alive"))
    total_count = len(results)

    timestamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    lines = [f"Health Check — {timestamp}", f"Alive: {alive_count}/{total_count}", ""]

    for r in results:
        status_icon = "✅" if r.get("alive") else "❌"
        lines.append(f"{status_icon} {r.get('app_name')} — {r.get('render_url')}")

    summary = "\n".join(lines)
    await registry.update_health_topic(summary)

    migrate_candidates = []

    for r in results:
        app_name = r.get("app_name")
        alive = r.get("alive", False)
        if not app_name:
            continue

        existing = await registry.get_deployment(app_name)
        if not existing:
            continue

        if alive:
            # Reset failure counter on recovery
            msg_id = existing.get("message_id") or existing.get("_message_id")
            if msg_id and existing.get("fail_count", 0) > 0:
                existing["fail_count"] = 0
                existing["status"] = "alive"
                existing.pop("_message_id", None)
                await registry._edit_message(msg_id, json.dumps(existing, indent=2))
            else:
                await registry.update_deployment_status(app_name, "alive")
        else:
            # Skip services still building
            if existing.get("status") == "deploying":
                continue

            # Increment failure counter
            msg_id = existing.get("message_id") or existing.get("_message_id")
            fail_count = existing.get("fail_count", 0) + 1
            if msg_id:
                existing["fail_count"] = fail_count
                existing["status"] = "suspended"
                existing.pop("_message_id", None)
                await registry._edit_message(msg_id, json.dumps(existing, indent=2))

            # After 3 consecutive failures, queue for auto-migration
            if fail_count >= 3 and existing.get("repo_url"):
                migrate_candidates.append(app_name)

    # Trigger migration in background for persistently dead services
    for app_name in migrate_candidates:
        await registry.log_event(f"AUTO-MIGRATE queued: {app_name} (3+ failures)")
        background_tasks.add_task(_do_migrate, app_name)

    return {"updated": total_count, "migrating": migrate_candidates}
