# Self-hosting myprettycloud

This guide takes you from a fresh clone to your own running instance, first on
your machine and then in production (Clever Cloud, or any server).

**Contents**

1. [What you are going to run](#1-what-you-are-going-to-run)
2. [Prerequisites](#2-prerequisites)
3. [Create a Clever Cloud OAuth consumer](#3-create-a-clever-cloud-oauth-consumer)
4. [Run it locally](#4-run-it-locally)
5. [Deploy on Clever Cloud](#5-deploy-on-clever-cloud)
6. [Deploy anywhere else](#6-deploy-anywhere-else)
7. [Environment variables reference](#7-environment-variables-reference)
8. [Optional features](#8-optional-features)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. What you are going to run

```text
 browser ──HTTPS──▶ frontend (Node, frontend/server.mjs)          ← the only public entry point
                     ├─ serves the static Next.js export (frontend/out/)
                     └─ proxies /api /auth /ws /webhooks /mcp /.well-known
                              │
                              ▼
                    backend (Rust, myprettycloud-server :8080) ──▶ PostgreSQL
                              │                                  └▶ Pulsar (optional)
                              ▼
                    Clever Cloud API + Warp10 metrics (with each user's OAuth token)
```

- **Users sign in with their own Clever Cloud account** (OAuth 1.0a). The instance
  then reads *their* organisations, applications, add-ons and metrics with *their*
  token. Anyone with a Clever Cloud account can use your instance and sees only
  what their own account can see.
- The **backend** holds all the logic: sessions, poller, rule engine, notifications
  and MCP. It applies its database migrations on boot.
- The **frontend** is a static export plus a small Express server. The browser only
  ever talks to the frontend origin, so the backend does not need to be public.
- The **3D assets** are not in the repository. You buy and install them as
  described in [`ASSETS.md`](ASSETS.md).

---

## 2. Prerequisites

| Tool | Version | Used for |
|---|---|---|
| Rust | 1.85+ (edition 2024) | backend |
| Node.js | 20+ | frontend build + server, asset installer |
| Docker + Compose | any recent | local PostgreSQL (and optional Pulsar) |
| `unzip` (or bsdtar) | — | asset installer |
| A Clever Cloud account | — | OAuth login; also the deployment target in §5 |
| The two KayKit SOURCE packs | — | the 3D city ([`ASSETS.md`](ASSETS.md)) |

---

## 3. Create a Clever Cloud OAuth consumer

The login flow needs an **OAuth consumer**: a key/secret pair that identifies
your instance to Clever Cloud.

### How the callback is checked

The backend asks Clever Cloud to send users back to **`<APP_URL>/auth/callback`**.
Clever Cloud accepts that callback only if its **scheme and host** match the
consumer's *base URL*. Port and path are ignored. So:

- `http://localhost` covers local development on any port;
- `https://myprettycloud.example.com` covers your production instance.

The scheme must match too. Create **one consumer per environment**: one for
local (`http://localhost`) and one for production (`https://…`).

### Option A — Console

1. Open the [Clever Cloud Console](https://console.clever-cloud.com) and select
   the organisation (or personal space) that should own the consumer.
2. Click **Create…** → **an OAuth consumer**.
3. Fill the form:
   - **Name / description**: shown to users on the consent screen, for example
     "myprettycloud (my company)".
   - **Application URL**: your instance's public URL.
   - **Base URL**: the callback base, for example `http://localhost:3000` or
     `https://myprettycloud.example.com`.
   - **Logo**: optional.
   - **Rights**: tick **Access personal information** and **Access organisations**
     (see below).
4. Save, then copy the **consumer key** and **consumer secret**.

### Option B — CLI (`clever-tools` 4.8+)

```bash
clever oauth-consumers create "myprettycloud (local)" \
  --description "Self-hosted myprettycloud" \
  --url http://localhost:3000 \
  --base-url http://localhost:3000 \
  --rights access-personal-information,access-organisations

clever oauth-consumers list
clever oauth-consumers get <consumer-key> --with-secret   # prints the secret
```

Add `--org <org-id|org-name>` to make an organisation own the consumer instead of
your personal account.

### Which rights

| Right | Why |
|---|---|
| `access-personal-information` | read the signed-in user (`/v2/self`): id, email, name |
| `access-organisations` | list organisations, applications, add-ons and their metrics token |

That is enough for the city, the dashboards and the workflows. The **optional**
Clever Cloud webhooks integration (§8) creates notification webhooks on the user's
organisations, which needs a *manage* right on top (`manage-organisations`).
Grant it only if you enable that feature. Ask for the smallest set you need: users
see the list on the consent screen.

> Keep the **consumer secret** private. It belongs in the backend's environment
> only, never in the frontend, a commit or a ticket.

---

## 4. Run it locally

Everything below runs from the repository root unless stated otherwise.

### 4.1 Database

```bash
docker compose up -d     # PostgreSQL on localhost:5433 (+ Pulsar on :6650, optional)
```

### 4.2 Backend

```bash
cp .env.example .env
```

Edit `.env` (the backend loads it on start):

```dotenv
DATABASE_URL=postgres://mpc:mpc@localhost:5433/myprettycloud   # matches docker-compose
APP_ENV=development
# The URL the browser uses, i.e. the frontend server (it proxies /auth to the backend).
APP_URL=http://localhost:3000
FRONTEND_URL=http://localhost:3000
# openssl rand -base64 32   (optional in dev; without it sessions die on every restart)
ENCRYPTION_KEY=
CC_OAUTH_CONSUMER_KEY=<your local consumer key>
CC_OAUTH_CONSUMER_SECRET=<your local consumer secret>
```

```bash
cargo run -p myprettycloud-server      # :8080, migrations auto-apply
curl localhost:8080/health             # → ok
```

### 4.3 Frontend

```bash
cd frontend
npm install
npm run assets:install                 # once, see docs/ASSETS.md
npm run build                          # static export → out/
PORT=3000 BACKEND_INTERNAL_URL=http://localhost:8080 npm start
```

Open **<http://localhost:3000>**, click **Sign in with Clever Cloud**, approve the
consent screen and you land on the org picker, then in your city. Buildings start
grey and take their colours within a polling cycle.

> **`npm run dev` is UI-only.** The Next dev server does not proxy `/api`, `/auth`
> or `/ws` to the backend, so you cannot sign in with it. Use it for pure UI work.
> For anything that needs data, use `npm run build` + `npm start` as above.

---

## 5. Deploy on Clever Cloud

This is how the reference instance runs: **two applications** (Rust backend +
Node frontend), a **PostgreSQL** add-on, and a **Cellar** (S3) bucket for the 3D
assets. Clever Cloud builds from your git repository, which does not contain the
git-ignored assets, so they must come from the bucket ([`ASSETS.md`](ASSETS.md) §4,
option B).

Replace `<org>` with your organisation id or name. Run the commands from your
clone of the repository.

### 5.1 Backend

```bash
clever create myprettycloud-backend --type rust --org <org> --region par --alias mpc-backend
clever addon create postgresql-addon mpc-db --plan <plan> --org <org> --region par \
  --link mpc-backend                                         # injects POSTGRESQL_ADDON_URI

clever env set --alias mpc-backend PORT 8080
clever env set --alias mpc-backend APP_FOLDER .
clever env set --alias mpc-backend CC_RUST_BIN myprettycloud-server
clever env set --alias mpc-backend APP_ENV production
clever env set --alias mpc-backend ENCRYPTION_KEY "$(openssl rand -base64 32)"
clever env set --alias mpc-backend CC_OAUTH_CONSUMER_KEY    <prod consumer key>
clever env set --alias mpc-backend CC_OAUTH_CONSUMER_SECRET <prod consumer secret>
# Both point at the FRONTEND public URL (it proxies /auth; cookies live there).
clever env set --alias mpc-backend APP_URL      https://<your-frontend-domain>
clever env set --alias mpc-backend FRONTEND_URL https://<your-frontend-domain>
clever config update --alias mpc-backend --enable-force-https
clever scale --alias mpc-backend --build-flavor M            # Rust release builds need RAM
```

> Keep `ENCRYPTION_KEY` stable and backed up. It encrypts the users' Clever Cloud
> tokens at rest. If you change it, every user has to sign in again.

### 5.2 3D assets bucket (Cellar)

```bash
clever addon create cellar-addon mpc-assets --org <org> --region par
clever addon env <cellar-addon-id>      # CELLAR_ADDON_KEY_ID / _SECRET / _HOST
```

Create a bucket, upload `frontend/public/assets/` under the `assets/` prefix, make
it public-read and allow your frontend origin in CORS. The step-by-step (with the
`--signature-v2` flag Cellar needs) is in [`ASSETS.md`](ASSETS.md) §4, option B.
Note the bucket's public base URL, for example
`https://<bucket>.cellar-c2.services.clever-cloud.com`.

### 5.3 Frontend

```bash
clever create myprettycloud-frontend --type node --org <org> --region par --alias mpc-frontend

clever env set --alias mpc-frontend PORT 8080
clever env set --alias mpc-frontend APP_FOLDER ./frontend
clever env set --alias mpc-frontend CC_NODE_DEV_DEPENDENCIES install
clever env set --alias mpc-frontend CC_POST_BUILD_HOOK "npm --prefix ./frontend run build"
clever env set --alias mpc-frontend BACKEND_INTERNAL_URL https://<backend-app>.cleverapps.io
clever env set --alias mpc-frontend NEXT_PUBLIC_CDN_BASE_URL https://<bucket-public-base-url>
clever config update --alias mpc-frontend --enable-force-https
clever scale --alias mpc-frontend --flavor nano --build-flavor S
```

`NEXT_PUBLIC_CDN_BASE_URL` is baked in at build time. If you change it, redeploy
the frontend. Without it the build stops at the asset check.

Optionally add your own domain (`clever domain add … --alias mpc-frontend`), then
use it in `APP_URL` / `FRONTEND_URL` and in the OAuth consumer's base URL.

### 5.4 Deploy

```bash
clever deploy --alias mpc-backend      # first, and whenever a migration/API changed
clever deploy --alias mpc-frontend
```

Then open `https://<your-frontend-domain>` and sign in.

---

## 6. Deploy anywhere else

Any host that can run a Linux binary, Node.js and PostgreSQL works:

1. **Backend**: `cargo build --release -p myprettycloud-server`, then run
   `target/release/myprettycloud-server` with the environment from §7
   (`APP_ENV=production`). It listens on `PORT` (default 8080) and does not need to
   be reachable from the internet, only from the frontend.
2. **Frontend**: `npm ci && npm run assets:install && npm run build` in `frontend/`,
   then run `node server.mjs` with `PORT` and `BACKEND_INTERNAL_URL` (for example
   `http://127.0.0.1:8080`). If you build with the assets installed and **without**
   `NEXT_PUBLIC_CDN_BASE_URL`, the models are served by `server.mjs` itself
   (option A in [`ASSETS.md`](ASSETS.md)).
3. **HTTPS**: put a TLS reverse proxy (Caddy, nginx, Traefik…) in front of the
   frontend server. It must pass **WebSocket upgrades** on `/ws`. In production the
   session cookie is `Secure`, so the instance must be served over HTTPS.
4. Set `APP_URL` and `FRONTEND_URL` to the public HTTPS URL and use a production
   OAuth consumer whose base URL matches it.

---

## 7. Environment variables reference

### Backend

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` (or `POSTGRESQL_ADDON_URI`) | **yes** | — | PostgreSQL connection string |
| `APP_ENV` | prod | `development` | `production` enables Secure cookies and requires the two lines below |
| `ENCRYPTION_KEY` | **prod** | random per process in dev | base64 of exactly 32 bytes (`openssl rand -base64 32`) |
| `CC_OAUTH_CONSUMER_KEY` / `CC_OAUTH_CONSUMER_SECRET` | **prod** | — | from §3 |
| `APP_URL` | yes | `http://localhost:<PORT>` | public URL users hit for `/auth`. Use the **frontend** URL. The OAuth callback is `<APP_URL>/auth/callback` |
| `FRONTEND_URL` | yes | `http://localhost:3000` | where users land after sign-in |
| `PORT` | no | `8080` | |
| `WS_POLL_STATUS_SECS` / `WS_POLL_METRICS_SECS` | no | `10` / `15` | realtime poller cadence |
| `CC_API_BASE_URL`, `WARP10_ENDPOINT` | no | Clever Cloud public endpoints | |
| `PULSAR_URL`, `PULSAR_TOKEN`, `PULSAR_NAMESPACE`, `PULSAR_TENANT` | no | — | §8 (also read from Clever Cloud's `ADDON_PULSAR_*`) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM` | no | port `587` | email notification channel |
| `USE_WEBHOOKS`, `WEBHOOKS_PUBLIC_URL` | no | `false` | §8 |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE` | no | — | error reporting (Sentry / GlitchTip) |
| `WORKFLOW_DEBUG`, `DEBUG_CC_API` | no | `false` | verbose diagnostics |

### Frontend

| Variable | When | Notes |
|---|---|---|
| `BACKEND_INTERNAL_URL` | run time, **required** | where `server.mjs` proxies `/api /auth /ws …` |
| `PORT` | run time | default `8080` |
| `NEXT_PUBLIC_CDN_BASE_URL` | **build** time | base URL of the assets bucket. Leave unset to serve the assets from the frontend itself |

---

## 8. Optional features

- **Pulsar**: durable alerting bus (escalations and webhook inbox). Without it the
  app runs and alerting degrades gracefully. Locally, `docker compose up -d`
  already starts one (`PULSAR_URL=pulsar://localhost:6650`).
- **Email notifications**: set the `SMTP_*` variables to enable the email channel.
- **Clever Cloud webhooks**: real-time deploy events instead of polling only. Set
  `USE_WEBHOOKS=true` and `WEBHOOKS_PUBLIC_URL` to a URL that Clever Cloud can reach
  and that routes `/webhooks` to your instance (your frontend URL works, since it
  proxies `/webhooks`). The OAuth consumer then needs a *manage* right (§3).
- **Error monitoring**: `SENTRY_DSN` (any Sentry-compatible server, such as GlitchTip).

---

## 9. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Clever Cloud shows `OAuth callback is invalid` (`13502`) | The consumer's base URL does not match `APP_URL` on **scheme + host**. For example `http` vs `https`, or `localhost` vs a domain. Use one consumer per environment. |
| Login fails with `failed to get request token` | Wrong or empty `CC_OAUTH_CONSUMER_KEY` / `_SECRET`, or the backend cannot reach `api.clever-cloud.com`. |
| After approving, you come back logged out / redirected to `/login` again | `APP_URL` does not point at the frontend origin, so the temporary `oauth_state` cookie set on `/auth/login` is not sent back on `/auth/callback`. Set `APP_URL` = `FRONTEND_URL` = the public frontend URL. Over plain HTTP in production, Secure cookies are dropped, so serve HTTPS. |
| Backend refuses to boot: `ENCRYPTION_KEY is required when APP_ENV=production` | Set a stable 32-byte base64 key (`openssl rand -base64 32`). |
| Everyone is logged out after each backend restart (dev) | No `ENCRYPTION_KEY` set, so a random one is generated per process. Set one in `.env`. |
| `npm run build` stops with `[assets] ✗ …` | Assets not installed and no CDN configured. See [`ASSETS.md`](ASSETS.md). |
| Sign-in button does nothing / `/auth/login` 404 in local dev | You are on `npm run dev` (UI-only). Use `npm run build` + `npm start` (§4.3). |
| `BACKEND_INTERNAL_URL is required` on frontend start | Set it to the backend's URL. |
| Buildings stay grey for a while after opening a city | Expected: they colour in as the first poll lands. If they stay grey, check the backend logs for Clever Cloud API or Warp10 errors (`DEBUG_CC_API=true`). |
| Top-bar **Docs** opens the hosted website | The in-app docs link points to the public documentation site. That is intended and works for self-hosted instances too. |
