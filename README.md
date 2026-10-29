# myprettycloud

Clever Cloud observability, rendered as a living 3D medieval city. Every
application and add-on of your Clever Cloud organisations is a building whose
colour, smoke, fire and traffic follow its real status and metrics. Click a
building for live metric dashboards; arm **workflows** (alerting rules) that ring
the town bell and notify you on Slack, email, webhooks…

- **Hosted instance**: <https://myprettycloud-frontend.cleverapps.io>
- **User documentation**: <https://myprettycloud-website.cleverapps.io/docs/>

## Features

- **The city**: a react-three-fiber scene of your apps and add-ons, updated in real
  time over WebSocket. Medieval and space themes, seasons, a builder mode to lay out
  your own town, and a mayor who comments on what happens.
- **Metrics**: per-building dashboards (CPU, memory, disk, network…) from Clever
  Cloud's Warp10.
- **Workflows**: a graph-based rule editor. Conditions on monitors trigger
  notifications (Slack, Discord, email, webhooks…) and city effects.
- **MCP server**: query and drive your city from an AI assistant (`/mcp`).

## Self-hosting

You can run your own instance, locally or in production. Users sign in with their
own Clever Cloud account.

👉 **[`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md)**: the complete guide
(prerequisites, Clever Cloud OAuth consumer, local run, deployment on Clever Cloud
or any server, environment variables, troubleshooting).

### 3D assets: not included, buy them first

The city is built from two **KayKit** asset packs by
[Kay Lousberg](https://www.kaylousberg.com). They are **not** in this repository.
Buy the **Source Files** edition of each pack, download the archive, and let the
installer put the files in place:

| Pack | Archive |
|---|---|
| [KayKit Medieval Hexagon Pack](https://kaylousberg.itch.io/kaykit-medieval-hexagon) | `KayKit_Medieval_Hexagon_Pack_1.0_SOURCE.zip` |
| [KayKit Space Base Bits](https://kaylousberg.itch.io/space-base-bits) | `KayKit_Space_Base_Bits_1.0_SOURCE.zip` |

```bash
cd frontend && npm install && npm run assets:install   # reads the zips from ~/Downloads
```

Step-by-step guide, production / CDN setup and troubleshooting:
**[`docs/ASSETS.md`](docs/ASSETS.md)**.

### Quick start (local)

Short version of [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md) §4. You need Rust
1.85+, Node 20+, Docker, a [Clever Cloud OAuth consumer](docs/SELF_HOSTING.md#3-create-a-clever-cloud-oauth-consumer)
with base URL `http://localhost:3000`, and the KayKit archives.

```bash
# 1. Database (PostgreSQL :5433, + optional Pulsar :6650)
docker compose up -d

# 2. Backend: set CC_OAUTH_CONSUMER_KEY/SECRET and APP_URL=FRONTEND_URL=http://localhost:3000
cp .env.example .env
cargo run -p myprettycloud-server          # :8080, migrations auto-apply

# 3. Frontend (in another terminal)
cd frontend
npm install
npm run assets:install
npm run build
PORT=3000 BACKEND_INTERNAL_URL=http://localhost:8080 npm start
```

Open <http://localhost:3000> and sign in with Clever Cloud. (`npm run dev` is a
UI-only dev server, without the backend proxy, so sign-in does not work there.)

## Stack

- **Backend**: Rust (Axum) Cargo workspace. `crates/core` holds the logic (auth,
  Clever Cloud client, Warp10, realtime hub, poller, rule engine, notifications,
  MCP); `crates/server` is the binary.
- **Frontend**: Next.js 16 static export + React 19 + Three.js / react-three-fiber,
  served by a small Express server (`frontend/server.mjs`) that proxies the API and
  WebSocket.
- **Data**: PostgreSQL (state and LISTEN/NOTIFY realtime bridge), Clever Cloud API,
  Warp10 metrics, optional Apache Pulsar (durable alerting bus).

## Repository layout

```
crates/core/        # all backend logic (auth, cc, warp10, realtime, poller, rules, mcp, db…)
crates/server/      # thin binary: wiring + serve
migrations/         # PostgreSQL schema, applied on boot
frontend/           # Next.js app (3D city, dashboards, workflow editor) + server.mjs
website/            # Astro marketing + documentation site
docs/               # SELF_HOSTING, ASSETS, DEVELOPER_GUIDE, USER_MANUAL
```

## Documentation

- [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md): run your own instance, locally or in production.
- [`docs/ASSETS.md`](docs/ASSETS.md): buying and installing the KayKit 3D assets.
- [`docs/DEVELOPER_GUIDE.md`](docs/DEVELOPER_GUIDE.md): how the app is built and how the code works.
- [`docs/USER_MANUAL.md`](docs/USER_MANUAL.md): how to use the app (end users).

## License

The myprettycloud source code is licensed under the
[GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`). If you run a
modified version as a network service, you must offer its source code to your users.

The license covers the code only. The KayKit 3D assets (© Kay Lousberg, distributed
by their author under CC0), the ambient music and the mayor portraits are **not**
part of this repository and are **not** covered by it. See
[`docs/ASSETS.md`](docs/ASSETS.md).
