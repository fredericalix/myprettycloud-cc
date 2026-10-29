---
name: myprettycloud
description: AI developer guide and workflow playbooks for the myprettycloud repository — a Clever Cloud observability product that renders infrastructure as a live 3D medieval city (Rust/Axum backend + Next.js / react-three-fiber frontend, deployed as two Clever Cloud apps). Use whenever working anywhere in this repo — to understand what the project is or how it's built, find where code lives, or follow a project workflow — deploying to Clever Cloud, adding a backend table/route/migration, changing the 3D city / realtime / assets, or uploading assets to Cellar (S3). Consult it before asking how this project works, before editing the backend or frontend, before deploying, and before touching the city or assets, even if you were not explicitly told to use a skill.
---

# myprettycloud — a developer guide for AI

You are working in **myprettycloud**: a Clever Cloud observability product. A user's
infrastructure (Clever Cloud apps + add-ons) is rendered as a **live 3D medieval
city** — each building is a resource, coloured by its live status — with metric
dashboards and an alerting/rule engine reached by **clicking buildings**.

This skill orients you and routes you to a step-by-step playbook for the task at
hand. It deliberately does **not** repeat two documents you should lean on:

- **`CLAUDE.md`** (repo root) — operational rules, always in context. The source of
  truth for conventions; obey it.
- **`docs/DEVELOPER_GUIDE.md`** — the full architecture. **`docs/USER_MANUAL.md`** —
  product behaviour. Read the relevant section when you need depth.

## How it's built

- **Backend** — Rust / Axum. All logic lives in the `mpc_core` library
  (`crates/core`); `crates/server` is a thin binary (`main.rs`) that wires config,
  migrations, sessions, middleware, the router, and the poller.
- **Frontend** — Next.js 16 / React 19 / react-three-fiber, built as a **static
  export** (`output:"export"` → `out/`) and served in prod by `frontend/server.mjs`
  (Express + http-proxy-middleware), **not** Next rewrites. `server.mjs` reverse-
  proxies `/api /auth /ws /webhooks /mcp /.well-known` to the backend and tunnels the
  WebSocket upgrade.
- **Data & messaging** — Postgres (schema via `migrations/`, `sqlx::migrate!` at
  boot) + Pulsar (escalations/consumers). Realtime is multi-instance-correct via
  Postgres `LISTEN/NOTIFY`: producers call `realtime::broadcast_via_pg(...)`, a
  `PgListener` task fans frames onto each instance's in-memory `OrgBus`, and
  `/ws?org=…` clients receive them. A single **60s poller** (`poller.rs`) refreshes
  app/add-on status + metrics and drives the **rule engine** (`rules/`, the crown
  jewel — JSONB conditions/actions).
- **Assets** — GLTF models, the texture atlas, music, and mayor images live on
  **Cellar (S3)**, loaded from `NEXT_PUBLIC_CDN_BASE_URL` (baked at build), not in
  `public/`.
- **Deploy** — three Clever Cloud apps (`mpc-backend`, `mpc-frontend`, `mpc-website`)
  in one org (`<org-id>`); aliases linked in the git-ignored `.clever.json`, real
  identifiers in the git-ignored `CLAUDE.local.md`.
- **Website / docs** — `website/` is an Astro 5 site (landing + `/docs` + `/tutorial`)
  at `https://myprettycloud-website.cleverapps.io`, served by `website/server.mjs`.
  Its docs pages (`website/src/content/docs/*.md`) mirror `docs/USER_MANUAL.md`.

## Repo map

- `crates/core` (lib `mpc_core`) — `auth cc warp10 realtime poller rules groups
  notifications bus webhooks domains/{town,metrics} handlers mcp db`.
- `crates/server/src/main.rs` — wiring + the Axum router assembly.
- `migrations/` — consolidated SQL, `00NN_*.sql` (currently up to `0019`).
- `frontend/src/city/*` — the 3D city (stores, ws, components/scene, mayor, utils,
  data). `frontend/src/overlays/*` — cross-cutting overlays. `frontend/src/features/
  monitor/*` — the monitor/rules feature (React Query).

## Non-negotiable conventions (full list in `CLAUDE.md`)

- English everywhere (code, comments, identifiers, docs).
- Backend: return `AppError` (never leak upstream detail); DB only through `db::*`
  repositories; handlers/MCP tools stay thin.
- Org-scoped routes MUST call `auth::authz::validate_cc_id` + `require_org_member`;
  user-scoped routes use the `AuthUser` extractor (`auth.0.id`).
- Emit realtime frames via `realtime::broadcast_via_pg(...)`, never the local bus.
- Frontend: Zustand for realtime/scene/UI, React Query for monitor data. Heavy DOM
  (ECharts, ReactFlow) never inside the R3F `<Html>` projection — portal modals to
  `document.body`.
- Only deploy when explicitly asked, with a green build first.
- **Docs ship with the change.** Any frontend/backend modification that alters
  user-facing behaviour must update `docs/USER_MANUAL.md` AND the website docs
  (`website/src/content/docs/*.md`, tutorial if a flow changed), and `mpc-website`
  must be deployed alongside the app deploys. See `references/deploy.md`.

## Routing — read the matching playbook before acting

| You are about to… | Read |
|---|---|
| Deploy / ship / release to Clever Cloud | `references/deploy.md` |
| Add a table / endpoint / migration / repository / handler | `references/backend-feature.md` |
| Touch the 3D city, status colours, realtime frames, overlays, or the mayor | `references/city-scene.md` |
| Upload or replace GLTF / atlas / music / mayor images | `references/cellar-assets.md` |

Open the reference file the moment the task matches — it has the exact commands,
file paths, and gotchas. When in doubt about deeper architecture, follow the
reference's pointer into `docs/DEVELOPER_GUIDE.md`.
