import os
from dotenv import load_dotenv

load_dotenv()

TELEGRAM_API_ID = int(os.getenv("TELEGRAM_API_ID", "0"))
TELEGRAM_API_HASH = os.getenv("TELEGRAM_API_HASH", "")
TELEGRAM_SESSION = os.getenv("TELEGRAM_SESSION", "my_vault2")
TELEGRAM_SESSION_STRING = os.getenv("TELEGRAM_SESSION_STRING", "")

REGISTRY_GROUP_ID = int(os.getenv("REGISTRY_GROUP_ID", "0"))
TOPIC_REGISTRY = int(os.getenv("TOPIC_REGISTRY", "0"))
TOPIC_ACCOUNTS = int(os.getenv("TOPIC_ACCOUNTS", "0"))
TOPIC_LOGS = int(os.getenv("TOPIC_LOGS", "0"))
TOPIC_HEALTH = int(os.getenv("TOPIC_HEALTH", "0"))

CLOUDFLARE_API_TOKEN = os.getenv("CLOUDFLARE_API_TOKEN", "")
CLOUDFLARE_ZONE_ID = os.getenv("CLOUDFLARE_ZONE_ID", "")
BASE_DOMAIN = os.getenv("BASE_DOMAIN", "airdeploy.xyz")

ORCHESTRATOR_SECRET = os.getenv("ORCHESTRATOR_SECRET", "")

RENDER_API_BASE = "https://api.render.com/v1"
CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4"

GITHUB_API_BASE = "https://api.github.com"
