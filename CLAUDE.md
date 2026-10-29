# CLAUDE.md

Operational guide for working in this repo. Read `docs/DEVELOPER_GUIDE.md` for the full
architecture and `docs/USER_MANUAL.md` for the product behaviour.

There is also a Claude skill at `.claude/skills/myprettycloud/` — an AI-facing orientation
guide plus step-by-step playbooks (deploy · backend feature · city/scene · Cellar assets).
It loads on demand; consult its references before deploying, adding a backend table/route, or
touching the city/assets.

## What it is

`myprettycloud` — a Clever Cloud observability product: your infra rendered as a live 3D
medieval city (the shell), with metric dashboards and an alerting/rule engine reached by
clicking buildings. Rust/Axum backend + Next.js 16 / React 19 / react-three-fiber frontend.
Deployed on Clever Cloud as **two apps** (backend + frontend) in one org (`<org-id>`; the
real identifiers of the hosted instance live in the git-ignored `CLAUDE.local.md`).

## Layout

- `crates/core` (lib `mpc_core`) — all logic: `auth cc warp10 realtime poller rules groups
  notifications bus webhooks domains/{town,metrics} handlers mcp db`.
- `crates/server` — thin binary `myprettycloud-server` (wiring only, `main.rs`).
- `migrations/` — consolidated Postgres schema, `sqlx::migrate!` at boot (currently `0001..0023`).
- `frontend/` — Next.js app. The 3D city lives under `src/city/*`; cross-cutting overlays in
  `src/overlays/*`; the monitor/rules feature in `src/features/monitor/*`.
- `website/` — Astro 5 marketing + docs site (landing, `/docs` multi-page from
  `src/content/docs/*.md`, `/tutorial`), served by `website/server.mjs`. Deployed as a third CC
  app, alias **`mpc-website`** (`APP_FOLDER=./website`, build via `CC_POST_BUILD_HOOK`) at
  `https://myprettycloud-website.cleverapps.io`.

## Commands

```bash
# Backend
cargo build                       # workspace
cargo clippy                      # expected: zero warnings
cargo test                        # rule-engine + parse unit tests
cargo run -p myprettycloud-server # serves :8080, auto-applies migrations
docker compose up -d              # Postgres :5433 + Pulsar :6650 for local dev

# Frontend  (static export → out/, served in prod by server.mjs)
cd frontend
npm install
npm run build                     # next build with output:"export" → out/
npm run dev                       # Next dev server (UI only; no backend proxy)

# Website  (Astro marketing + docs site → dist/, served in prod by website/server.mjs)
cd website
npm install
npm run build                     # astro build → dist/
npm run dev                       # Astro dev server
```

## Deploy (Clever Cloud, `clever` CLI v4)

Three aliases: **`mpc-backend`** (Rust), **`mpc-frontend`** (Node) and **`mpc-website`**
(Astro docs/marketing site). Deploy backend first when a migration/API changed, then the
frontend.

```bash
clever deploy --alias mpc-backend     # runs migrations on boot
clever deploy --alias mpc-frontend
clever deploy --alias mpc-website     # whenever docs changed (see rule below)
```

- Only deploy when asked. Always `cargo build` (backend) and `npm run build` (frontend) green first.
- **Docs follow the product — every time.** Any frontend/backend change that alters user-facing
  behaviour (UI, flows, features, endpoints users touch) MUST land with the docs updated in the
  same change: `docs/USER_MANUAL.md` (the source manual) **and** the website mirror
  (`website/src/content/docs/*.md`, plus `website/src/pages/tutorial.astro` if a flow changed).
  Then deploy **`mpc-website`** alongside the app deploys (`npm --prefix website run build` green
  first). A deploy of `mpc-frontend`/`mpc-backend` that changed behaviour without a matching
  docs update + `mpc-website` deploy is an incomplete deploy.
- Probe new endpoints unauthenticated → expect **401/404-not-404** (route exists) before declaring done.
- Backend internal app id `<backend-app-id>`; frontend public URL `https://myprettycloud-frontend.cleverapps.io`.

## Critical gotchas (learned the hard way)

- **Frontend is a static export served by `frontend/server.mjs`** (Express + http-proxy-middleware),
  NOT Next rewrites. `server.mjs` reverse-proxies `/api /auth /ws /webhooks /mcp /.well-known` →
  `BACKEND_INTERNAL_URL` and tunnels the WebSocket upgrade. It serves an explicit route for
  `/login` because Next 16 emits a colliding `out/login/` dir that shadows the `.html`, and
  302-redirects `/docs` to the website (the in-app docs page was removed — the top-bar Docs
  button opens `https://myprettycloud-website.cleverapps.io/docs/` in a new tab); its
  compression filter skips binaries/Range so the CC HTTP/2 edge doesn't corrupt `.bin/.png/glb`.
  If you add a top-level App-Router page, add an explicit `server.mjs` route for it.
- **Assets (GLTF + atlas + music + mayor) live on Cellar (S3), not in `public/`.** The frontend
  loads them from `NEXT_PUBLIC_CDN_BASE_URL` (baked at build time). Upload with **s3cmd using
  `--signature-v2`** (v4 hangs on Cellar); creds via `clever addon env <cellar-addon-id>`
  (`CELLAR_ADDON_KEY_ID/SECRET/HOST`), bucket `<your-bucket>`, keys under `assets/…`.
  They are **never committed** (paid KayKit SOURCE packs; repo is AGPL open source): locally
  `npm --prefix frontend run assets:install` extracts the purchased zips into the git-ignored
  `frontend/public/assets/`; `predev`/`prebuild` fail fast via `assets:check` when they are
  missing and `NEXT_PUBLIC_CDN_BASE_URL` is unset. See `docs/ASSETS.md`.
- **All KayKit models share ONE texture atlas** (`assets/gltf/tiles/base/hexagons_medieval*.png`);
  the loader replaces every material's `.map` with it. Swapping that one texture re-skins the whole
  city (season themes). The catalog (`src/city/data/assetCatalog.ts`) already lists the entire kit.
- **NL rule generation uses LM Studio** (OpenAI-compatible), not Anthropic. Set `LMSTUDIO_BASE_URL`
  / `LMSTUDIO_MODEL` on the backend; disabled (400) when unset. The endpoint is kept but **not
  surfaced in the UI** (workflow creation is graph-editor-only; `NaturalLanguageRule.tsx` stays on
  disk, unreferenced).
- **Rules == "workflows".** Rules are user-scoped (`rules.user_id`) and tagged with `cc_org_id`
  (the org of the monitors a rule watches) for the Workflows manager — listed via
  `GET /api/orgs/{cc_org_id}/rules`. They fire **reactively**: the poller calls
  `rules::exec::trigger_for_monitor` only on a state transition / fresh metric for the monitors a
  rule's *condition* references (`rule_dependencies` inverse index). Set **`WORKFLOW_DEBUG=1`** on
  the backend to log the lifecycle — zero-dependents for a monitor, fields resolving to `Null`
  (unpolled monitor / no metric yet), per-leaf condition verdicts, and save-time dep indexing — the
  usual reasons a saved workflow silently never fires. `GET /api/rules/{id}/debug` returns the same
  diagnosis on demand (surfaced in the manager's Diagnose panel).
- **Per-scene settings** (ambiance toggles + season theme) persist in `maps.settings` (JSONB),
  applied on map load — see `useMapStore` / `useAnimationStore` / `useAssetStore`.
- **City status/metrics come ONLY from the poller** (`poll_city_org`), broadcast on the 60s tick.
  Buildings start grey ("unknown") on open until a frame lands. To shorten that, `poll_city_org` is
  also kicked **once on WS connect** (`realtime/handler.rs`, fire-and-forget, throttled per-org via
  `OrgBus::try_mark_polled`, keyed on the map owner via `db::maps::map_owners_for_org`). The Mayor
  shows a **pinned** "stocktake" loading notice (`useMayorCityLoading` + `useMayorStore.pinned`,
  which bypasses the mute switch) with live progress until every bound building is status-known and
  coloured, then an all-clear/trouble verdict. REST app/addon state is NOT fed to the colour store.
- zsh: unquoted `$VAR` does NOT word-split — inline flags or use arrays.

## Backend conventions

- English everywhere (code, comments, identifiers, docs).
- Return `AppError`; never leak upstream detail to clients.
- DB only through `db::*` repositories; handlers/MCP tools stay thin.
- Org-scoped routes MUST call `auth::authz::validate_cc_id` + `require_org_member`. User-scoped
  routes use the `AuthUser` extractor (`auth.0.id`).
- Emit realtime frames via `realtime::broadcast_via_pg(...)` (Postgres NOTIFY), never the local bus.
- New table → migration `00NN_*.sql` + a `db::<table>.rs` repository module (+ `db/mod.rs`).

## Frontend conventions

- State boundary: **Zustand** for realtime/scene/UI (`src/city/stores/*`), **React Query** for
  monitor server data (`src/features/monitor/*`).
- City API client = `src/city/api/*` via `api()` (credentials:'include'); monitor side uses
  `apiFetch` (`src/lib/api.ts`).
- Heavy DOM (ECharts, ReactFlow) must never mount inside the R3F `<Html>` projection. Modals that
  open from the top bar / drawer are **portalled to `document.body`** (the `.cc-panel`
  backdrop-filter traps `position:fixed` otherwise) — see `ChannelsModal`/`TemplatesModal`/
  `AdvancedRuleEditorModal`, reuse the `rule-modal-backdrop`/`rule-modal-panel` classes.
- Rule authoring is **builder-mode only**, via the Workflows manager's graph editor (TopBar → ⚙️;
  the BuildingDrawer has no Rules tab and the Quick/NL creation paths were removed).
