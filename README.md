# AirDeploy

A free PaaS platform. Submit a GitHub repo → get a live URL like `yourapp.airdeploy.xyz`.

## Architecture

```
User → airdeploy.xyz (Vercel/Next.js dashboard)
     → deploy form → Orchestrator (FastAPI on Render)
                    → Render.com API (one of N free accounts)
                    → Cloudflare DNS (CNAME record)
                    → Telegram (registry, logs, health)

Traffic: *.airdeploy.xyz → Vercel Edge Gateway → Render service URL
Cron:    Every 10 min → keepalive ping → update Telegram #health
```

## Setup (4 manual steps)

### 1. Generate Pyrogram session

```bash
cd orchestrator
pip install pyrogram tgcrypto
python - <<'EOF'
from pyrogram import Client
app = Client("my_vault2", api_id=YOUR_API_ID, api_hash="YOUR_API_HASH")
app.run(app.get_me())
EOF
# This creates my_vault2.session — commit it or mount it as a Render secret file
```

### 2. Create Telegram group with 4 topics

1. Create a Telegram group and enable Topics (Settings → Topics)
2. Create 4 topics: `registry`, `accounts`, `logs`, `health`
3. Note the group ID and each topic's message thread ID
4. Add your Telegram account to the group as admin

Get group ID: forward a message to @userinfobot or use `client.get_chat("@groupusername")`

### 3. Deploy the orchestrator

```bash
# Option A: render.yaml (one-click)
# Connect this repo to Render, it will pick up render.yaml automatically
# Set all environment variables in the Render dashboard

# Option B: manual
# Create a new Web Service on Render
# Root: orchestrator/
# Build: pip install -r requirements.txt
# Start: uvicorn main:app --host 0.0.0.0 --port $PORT
```

Set these env vars in Render:
```
TELEGRAM_API_ID        = your Telegram API ID
TELEGRAM_API_HASH      = your Telegram API hash
TELEGRAM_SESSION       = my_vault2
REGISTRY_GROUP_ID      = -100xxxxxxxxxx
TOPIC_REGISTRY         = message thread ID
TOPIC_ACCOUNTS         = message thread ID
TOPIC_LOGS             = message thread ID
TOPIC_HEALTH           = message thread ID
CLOUDFLARE_API_TOKEN   = cf token with Zone:DNS:Edit
CLOUDFLARE_ZONE_ID     = your zone ID
BASE_DOMAIN            = airdeploy.xyz
ORCHESTRATOR_SECRET    = a long random secret
```

Upload `my_vault2.session` as a Secret File at path `/etc/secrets/my_vault2.session` and symlink or copy it into the working directory in your start command, or mount it at the orchestrator root.

### 4. Deploy gateway + dashboard to Vercel

```bash
# Gateway
cd gateway
vercel deploy --prod
# Set env vars in Vercel project settings:
# TELEGRAM_BOT_TOKEN, REGISTRY_GROUP_ID, TOPIC_REGISTRY,
# ORCHESTRATOR_URL, ORCHESTRATOR_SECRET, CRON_SECRET, BASE_DOMAIN

# Dashboard
cd dashboard
vercel deploy --prod
# Set: NEXT_PUBLIC_ORCHESTRATOR_URL, NEXT_PUBLIC_ORCHESTRATOR_SECRET
```

### 5. Cloudflare DNS

Add two records in Cloudflare for `airdeploy.xyz`:
- `CNAME  airdeploy.xyz     →  cname.vercel-dns.com`  (proxied)
- `CNAME  *.airdeploy.xyz   →  cname.vercel-dns.com`  (proxied)

In Vercel project settings → Domains, add `airdeploy.xyz` and `*.airdeploy.xyz`.

### 6. Add Render accounts

```bash
curl -X POST https://your-orchestrator.onrender.com/accounts \
  -H "X-Secret: YOUR_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"api_key": "rnd_xxxx", "email": "account1@gmail.com"}'
```

Repeat for each free Render account you want in the pool.

## API Reference

All endpoints require header `X-Secret: <ORCHESTRATOR_SECRET>`.

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Platform health stats |
| POST | /deploy | Deploy a new app |
| DELETE | /undeploy/{app_name} | Delete an app |
| POST | /redeploy/{app_name} | Trigger redeploy |
| GET | /deployment/{app_name} | Get deployment info |
| GET | /deployments | List all deployments |
| GET | /accounts | List accounts (masked keys) |
| POST | /accounts | Add a Render account |
| GET | /logs/{app_name} | Get Render logs |

### POST /deploy

```json
{
  "repo_url": "https://github.com/user/repo",
  "app_name": "my-app",
  "runtime": "node",
  "owner": "username",
  "env_vars": { "PORT": "3000" }
}
```

Response:
```json
{
  "subdomain": "my-app.airdeploy.xyz",
  "render_url": "https://my-app-abc123.onrender.com",
  "service_id": "srv-xxxx",
  "status": "alive"
}
```

## Folder Structure

```
airdeploy/
├── orchestrator/          # FastAPI backend (deploys to Render)
│   ├── main.py            # API routes
│   ├── deployer.py        # Core deploy/undeploy/redeploy logic
│   ├── render_api.py      # Render REST API client
│   ├── cloudflare_api.py  # Cloudflare DNS client
│   ├── registry.py        # Telegram Pyrogram registry
│   ├── pool.py            # Render account pool manager
│   ├── models.py          # Pydantic models
│   ├── config.py          # Env var loading
│   └── requirements.txt
├── gateway/               # Vercel Edge Function (proxy + keepalive)
│   ├── api/[...slug].js   # Wildcard proxy
│   ├── cron/keepalive.js  # Every-10-min keep-alive cron
│   └── vercel.json
├── dashboard/             # Next.js frontend (deploys to Vercel)
│   ├── pages/
│   │   ├── index.js       # Landing page
│   │   ├── dashboard.js   # Deployments list
│   │   ├── deploy.js      # Deploy form
│   │   └── logs/[appname].js
│   ├── next.config.js
│   └── package.json
├── render.yaml            # One-click Render deploy config
└── README.md
```
