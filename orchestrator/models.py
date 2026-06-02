from pydantic import BaseModel, Field
from typing import Optional, Dict, List
from datetime import datetime
from enum import Enum


class Runtime(str, Enum):
    node = "node"
    python = "python"
    static = "static"


class DeploymentStatus(str, Enum):
    deploying = "deploying"
    alive = "alive"
    suspended = "suspended"
    error = "error"


class AccountStatus(str, Enum):
    available = "available"
    full = "full"
    suspended = "suspended"


class DeployRequest(BaseModel):
    repo_url: str
    app_name: str
    runtime: Optional[Runtime] = None
    owner: str
    env_vars: Dict[str, str] = Field(default_factory=dict)
    branch: str = "main"
    region: str = "oregon"
    root_dir: str = ""
    build_command: str = ""
    start_command: str = ""


class UndeployRequest(BaseModel):
    owner: str


class RedeployRequest(BaseModel):
    owner: str


class AddAccountRequest(BaseModel):
    api_key: str
    email: str


class UpdateAccountRequest(BaseModel):
    status: Optional[str] = None
    services_count: Optional[int] = None


class DeploymentRecord(BaseModel):
    app_name: str
    subdomain: str
    render_url: str
    render_service_id: str
    cloudflare_record_id: str = ""
    account_id: str
    owner: str
    status: DeploymentStatus = DeploymentStatus.deploying
    last_ping: Optional[str] = None
    deployed_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")
    runtime: str
    message_id: Optional[int] = None


class AccountRecord(BaseModel):
    account_id: str
    api_key: str
    email: str
    services_count: int = 0
    status: AccountStatus = AccountStatus.available
    message_id: Optional[int] = None


class DeployResponse(BaseModel):
    subdomain: str
    render_url: str
    service_id: str
    status: str


class HealthResponse(BaseModel):
    total_accounts: int
    available_accounts: int
    total_deployments: int
    alive_deployments: int


class HealthUpdateRequest(BaseModel):
    results: List[Dict]


class UpdateEnvRequest(BaseModel):
    env_vars: Dict[str, str]


class UpdateSettingsRequest(BaseModel):
    branch: Optional[str] = None
    build_command: Optional[str] = None
    start_command: Optional[str] = None
