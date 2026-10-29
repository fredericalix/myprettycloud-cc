# myprettycloud

A unified Clever Cloud observability product. Your infrastructure rendered as a
living 3D medieval city: every app and add-on is a building whose status and
metrics drive its visuals. Click a building to open its metrics and to arm
monitoring rules. Alerts surface as events in the city — fires, bells, smoke.

This merges three prototypes into one application:

- **mycctown** — the real-time 3D city (the main shell).
- **myccmetrics** — metric dashboards (charts), reached through a building.
- **myccmonitor** — the alerting workflow engine + rule editor.

## Stack

- **Backend** — Rust (Axum) Cargo workspace: `crates/core` (library) + `crates/server` (binary).
- **Frontend** — Next.js 16 + React 19 + Three.js / react-three-fiber (added in milestone M6).
- **Data** — PostgreSQL, Warp10 (metrics), Apache Pulsar (alerting bus), Clever Cloud API + webhooks.

## Repository layout

```
Cargo.toml          # workspace
crates/core/        # shared foundation + feature domains + rule engine + MCP
crates/server/      # thin binary: wiring + serve
migrations/         # consolidated Postgres schema (M2+)
frontend/           # Next.js app (M6+)
docs/               # DEVELOPER_GUIDE.md + USER_MANUAL.md (M12)
```

## 3D assets — not included, buy them first

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

## Development

```bash
# 1. Infrastructure (Postgres :5433 + Pulsar :6650)
docker compose up -d

# 2. Backend — serves :8080, applies migrations on boot
cp .env.example .env        # fill ENCRYPTION_KEY + CC OAuth credentials
cargo run -p myprettycloud-server
curl localhost:8080/health

# 3. Frontend — install the 3D assets once (see above), then
cd frontend
npm install
npm run assets:install
npm run dev
```

## Documentation

- [`docs/ASSETS.md`](docs/ASSETS.md) — buying and installing the KayKit 3D assets.
- [`docs/DEVELOPER_GUIDE.md`](docs/DEVELOPER_GUIDE.md) — how the app is built and how the code works.
- [`docs/USER_MANUAL.md`](docs/USER_MANUAL.md) — how to use the app (end users).

## License

The myprettycloud source code is licensed under the
[GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`). If you run a
modified version as a network service, you must offer its source code to your users.

The license covers the code only. The KayKit 3D assets (© Kay Lousberg, distributed
by their author under CC0), the ambient music and the mayor portraits are **not**
part of this repository and are **not** covered by it. See
[`docs/ASSETS.md`](docs/ASSETS.md).

## Status

- **Backend — complete & verified.** Workspace + shared foundation, consolidated
  migrations + OAuth/sessions, security middleware, Warp10 client + token cache,
  realtime WS hub + Postgres NOTIFY bridge, unified poller, town maps, the full
  monitor domain (rule engine + handlers + notifications), webhooks + Pulsar
  consumers, MCP server, and the metrics dashboard API. Boots against Postgres
  (+ optional Pulsar); `cargo clippy` clean; unit tests pass.
- **Frontend — complete & building.** Next.js 16 app: the full react-three-fiber
  city (live status/metrics animate the buildings), backend reverse-proxy
  rewrites, auth + login + org selector, Forge design system. Clicking a building
  opens the **BuildingDrawer**: Overview (live), Metrics (ECharts), and Rules —
  the When/Then sentinel form, the advanced ReactFlow graph editor, and
  natural-language authoring (Claude via `/api/rules/generate`). Rule firings
  ring the bell; failed buildings catch fire.
