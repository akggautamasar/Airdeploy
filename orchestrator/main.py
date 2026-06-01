from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional, List
from datetime import datetime
import json

import deployer
import pool
import registry
import render_api
from pool import NoAccountAvailable
from models import (
    DeployRequest,
    UndeployRequest,
    RedeployRequest,
    AddAccountRequest,
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


@app.post("/deploy", response_model=DeployResponse, dependencies=[Depends(verify_secret)])
async def deploy_app(req: DeployRequest):
    try:
        result = await deployer.deploy(
            repo_url=req.repo_url,
            app_name=req.app_name,
            runtime=req.runtime.value if req.runtime else None,
            owner=req.owner,
            env_vars=req.env_vars,
        )
        return DeployResponse(**result)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except NoAccountAvailable as e:
        raise HTTPException(status_code=503, detail=str(e))
    except TimeoutError as e:
        raise HTTPException(status_code=504, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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


@app.post("/health/update", dependencies=[Depends(verify_secret)])
async def update_health(req: HealthUpdateRequest):
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

    for r in results:
        app_name = r.get("app_name")
        alive = r.get("alive", False)
        if app_name:
            status = "alive" if alive else "suspended"
            await registry.update_deployment_status(app_name, status)

    return {"updated": total_count}
