# myprettycloud — Developer Guide

This guide explains how the application is built and how the code works, so a
developer can get productive, extend it, and deploy it.

## 1. What it is

`myprettycloud` is a unified Clever Cloud observability product. It merges three
prototypes into one application:

- **Town** — your infrastructure rendered as a living 3D medieval city (the main
  shell). Each app/add-on is a building whose status and metrics drive its visuals.
- **Metrics** — historical metric dashboards (charts), reached by selecting a building.
- **Monitor** — an alerting workflow engine: rules, conditions, actions, escalations.

The product loop: **authenticate → poll Clever Cloud + Warp10 → evaluate rules →
notify → stream everything live to the browser**, with alerts surfacing as
gamified events in the city (fires, bells, smoke).

## 2. Architecture at a glance

```
┌────────────────────────── frontend/ (Next.js 16, React 19) ───────────────────────────┐
│  3D city (react-three-fiber) shell · BuildingDrawer overlays (Overview/Metrics/Rules)   │
│  reverse-proxies /api /auth /ws /webhooks /mcp → BACKEND_INTERNAL_URL                    │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                   │ HTTPS (same-origin via Next rewrites)
┌────────────────────────── crates/server (thin binary) ───────────────────────────────┐
│  wiring: config · migrations · sessions · security middleware · routers · poller ·      │
│          Pulsar connect · LISTEN/NOTIFY task                                            │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                   │ uses
┌────────────────────────── crates/core (library) ─────────────────────────────────────┐
│  auth(OAuth1.0a, AES-GCM, sessions, authz) · cc(CC API) · warp10(metrics+token cache) · │
│  realtime(WS hub + pg_notify bridge) · poller · rules(engine) · groups · notifications · │
│  bus(Pulsar) · webhooks · domains{town, metrics} · handlers · mcp · db(repositories)    │
└─────────────────────────────────────────────────────────────────────────────────────────┘
        │                 │                  │                    │
   PostgreSQL          Warp10           Clever Cloud API      Apache Pulsar
 (state, sessions,   (time-series      (OAuth, orgs/apps/    (durable webhook inbox
  LISTEN/NOTIFY)      metrics)          addons, webhooks)      + delayed escalations)
```

## 3. Backend layout (Cargo workspace)

```
Cargo.toml                 # [workspace] resolver=2; shared dep versions
crates/core/               # library crate `mpc_core` — all reusable logic
  src/
    config.rs              # Config::from_env (unified superset; ENCRYPTION_KEY base64,
                           #   CC_OAUTH_CONSUMER_KEY, Pulsar/SMTP/Sentry optional)
    error.rs               # AppError + IntoResponse (redacts upstream detail)
    state.rs               # AppState (db, http, config, org_cache, warp10_cache,
                           #   ws_bus, Pulsar producers)
    auth/                  # oauth (HMAC-SHA1), encryption (AES-256-GCM), session
                           #   (AuthUser + AuthenticatedUser extractors), authz
                           #   (require_org_member + validate_cc_id), routes
    cc/                    # Clever Cloud REST client (orgs/apps/addons/webhooks/metrics token)
    warp10/                # client (execute_warpscript), templates (WarpScript + GTS parse),
                           #   tokens (2-layer cache: memory + encrypted DB), fetch_metrics
    realtime/             # OrgBus (per-instance broadcast hub), frame (unified WsFrame),
                           #   handler (/ws), broadcast_via_pg + run_listen_notify
    poller.rs              # global advisory-locked poller (metric_readings + rule trigger)
    rules/                 # condition, field/EvalCtx, evaluator, cycle (petgraph),
                           #   actions, exec (cooldown + chain), dependencies, debug
    groups/                # monitor-group rollup + auto-grouping
    notifications/         # dispatch (3× backoff) + adapters (email/slack/discord/webhook)
                           #   + handlebars templating
    bus/                   # Pulsar connect + producers + consumer + escalations (optional)
    webhooks/              # POST /webhooks/cc/:token receiver + CC event parser
    domains/town/          # city maps CRUD routes
    domains/metrics/       # historical bucketized time-series query API
    handlers/              # REST: api (orgs/monitors/webhook), rules, groups,
                           #   channels, templates (scene templates), mcp_admin
    rules/nl.rs            # NL→rule generation via LM Studio (OpenAI-compatible)
    mcp/                   # rmcp Streamable HTTP server + Bearer auth + token mgmt
    db/                    # one module per table (repositories)
crates/server/             # binary `myprettycloud-server` — main.rs wiring only
migrations/                # consolidated Postgres schema (0001..0023)
```

**Why a workspace.** `core` holds the heavy, testable logic; `server` is a thin
binary. The split keeps incremental builds fast despite heavy deps (Pulsar/protobuf,
rmcp, lettre) and makes it trivial to add a second binary (e.g. a dedicated worker)
later.

## 4. Shared foundation

- **OAuth 1.0a** (`auth/oauth.rs`) — HMAC-SHA1 request signing for the CC API.
- **Encryption** (`auth/encryption.rs`) — AES-256-GCM. OAuth tokens at rest use a
  24-byte nonce = two concatenated 12-byte AES-GCM nonces (token || secret).
  `ENCRYPTION_KEY` (base64, 32 bytes) is **required in production**; dev generates
  an ephemeral key.
- **Sessions** — `tower-sessions` + Postgres store, cookie `mpc.sid`, `SameSite=Lax`
  (the frontend reverse-proxies the API, so the cookie is first-party to the
  frontend origin).
- **Tenant isolation** (`auth/authz.rs`) — `require_org_member` gates every
  org-scoped route via a short-lived org-membership cache; `validate_cc_id` blocks
  WarpScript/SQL injection through path params.
- **Security** (`crates/server/src/main.rs`) — `tower_governor` rate limit (1 rps,
  burst 60, IP key) on REST routes only; `/ws`, `/webhooks`, `/mcp` bypass it
  (long-lived / token-authed). Security headers + Sentry/GlitchTip layers.

## 5. Consolidated Postgres schema

Fresh, numbered migrations (`migrations/0001..0023`), run by `sqlx::migrate!` at
boot. The single coupling point is **`users`** — every monitor table cascades from
it. Key tables: `users` (+ MCP token columns), `warp10_tokens` (per user+org,
encrypted), `webhook_configs`, `webhook_dedup`, `maps` (city cells JSONB **+
`settings` JSONB** for per-scene ambiance/season — 0019), `monitors` (kind
`cc_application|cc_addon|synthetic`; synthetic = custom monitored buildings with
`cc_resource_id NULL`), `monitor_state_history`, `metric_readings` (per-metric
rows, pruned), `monitor_groups`(+members), `rules` (+ `cc_org_id` tag for the
Workflows manager — 0021), `rule_versions`, `rule_dependencies`, `rule_firings`,
`alerts`, `notification_channels`, `scene_templates` (user-owned, shareable map
layouts — 0018), `orgs` (cache).

## 6. Realtime layer

One per-instance `OrgBus` (DashMap of broadcast channels keyed by `cc_org_id`).
Producers never push locally — they emit `pg_notify('ws_broadcast', payload)`; a
`PgListener` task on every instance routes notifications onto its local `OrgBus`.
This makes delivery multi-instance correct: a frame produced on instance A reaches
a `/ws?org=…` client connected to instance B. The `__system__` channel carries
org-agnostic frames (rule firings). The frame enum (`realtime/frame.rs`) unifies
the city frames (AppStatus/AppMetrics/Addon*) and alerting frames
(MonitorState/MetricsSnapshot/RuleFiring). The city metrics frames carry
`cpu_pct`/`ram_pct` plus **`disk_pct` / `net_in_bps` / `net_out_bps`** — the
latter are `Option<f32>` + `#[serde(default)]` because frames round-trip through
the NOTIFY bridge and a rolling deploy can mix schema versions (covered by unit
tests in `frame.rs`). The net values are post-`mapper.rate` byte/s rates from
Warp10, sent raw: normalization is a frontend presentation concern.

## 7. Unified poller

A single global task per instance (`poller.rs`). Each 60s tick: select monitors
due for polling, group by (user, org), refresh app state from the CC API, run one
Warp10 batch per org (`warp10::fetch_metrics`, chunked), write `metric_readings`
(insert + prune), broadcast monitor frames via `pg_notify`, and trigger dependent
rules on transitions/fresh data. Per-monitor `pg_try_advisory_xact_lock` ensures
exactly one instance polls each resource per tick. (The city-frame pass —
`poll_city_org`, live status/metrics derived from `maps` + sticky deploy state —
layers onto this poller alongside the frontend.) To avoid a freshly-opened scene
sitting grey until the next tick, `poll_city_org` is **also kicked once
immediately when a WS subscriber connects** for an org (`realtime/handler.rs`):
fire-and-forget (never fails the upgrade), throttled per-org via
`OrgBus::try_mark_polled` (15s — coalesces StrictMode/backoff/multi-tab bursts),
and run for each map owner via `db::maps::map_owners_for_org` (the poll is keyed
on the map's author, not the connecting member). Buildings colour within ~1-3s.

## 8. Rule engine

The crown jewel (`rules/`). `condition` + `actions` are JSONB so the graph
editor and the runtime evaluator share one schema (the MCP tools and the
NL endpoint reuse it too).

- **Conditions** — AND/OR trees over monitor state + metric thresholds with
  `for Xm` time windows (read from `monitor_state_history` / `metric_readings`).
- **Actions** — `SetMonitorState` (chains: mutates a monitor, re-triggers its
  dependent rules under an anti-loop in-flight set + `MAX_CHAIN_DEPTH=8`),
  `SendNotification` (→ notifications dispatch), `Escalate` (delayed re-evaluation
  via Pulsar `deliver_at_time`).
- **Revert on recovery** — `SetMonitorState` takes an optional
  `revert_on_recovery: true`: the target's pre-action state (+message) is
  snapshotted into `rule_state_captures` on the episode's **first** matched
  firing (`ON CONFLICT DO NOTHING` — later firings would capture the
  already-overwritten state), and consumed (`DELETE … RETURNING`, atomic) when
  the rule's outcome transitions matched → not_matched. The restore is a normal
  transition: history row (source `rule_revert`), WS broadcast, and chaining
  into dependent rules under the same in-flight set + depth budget. Revert
  summaries land on the not_matched firing's `actions_executed`; revert errors
  never block recording the recovery. Captures are purged when the rule is
  saved (a stale restore is worse than a lost revert) and cascade away with
  their rule/monitor.
- **Cooldown** — recovery-exempt: a verdict transition always fires; repeats inside
  the window are skipped.
- **Cycle detection** — `petgraph` rejects rule graphs that would loop.
- **Versions** — last 5 snapshots kept per rule.
- **Diagnostics** — `GET /api/rules/{id}/debug` returns the rule, cooldown state,
  recent firings, referenced monitors/groups/channels, and a per-leaf **condition
  trace** (`rules/debug.rs::trace`): every comparison annotated with its live
  `actual` value and verdict. Leaf verdicts are **duration-aware** (they run the
  same `for_duration` time-check as the evaluator); the raw instantaneous
  comparison is echoed as `instantaneous`, so a UI can explain "true now, but not
  held for the window yet". Unlike `evaluate()`, the trace never short-circuits.
- **Dry-runs** — `POST /api/rules/{id}/test` evaluates a saved rule
  (`{matched, actions_that_would_run}`); `POST /api/rules/test-draft` evaluates an
  **unsaved** `{condition, actions}` body with the full per-leaf trace (same
  cross-user ref validation as save; nothing persisted, no cycle check, no
  cooldown) — this powers the rule editor's live Test overlay.
- **Debugging a silent rule** — set `WORKFLOW_DEBUG=1` on the backend to log the
  trigger lifecycle: zero-dependents for a monitor, fields resolving to `Null`
  (unpolled monitor / no reading yet), per-leaf verdicts, and save-time dependency
  indexing.

Entry points: `exec::trigger_for_monitor` (from the poller + webhook consumer) and
`exec::execute_rule`. Triggered by: poller (state/metric change), webhook consumer
(CC lifecycle events), and escalation consumer (delayed).

## 9. Notifications

`notifications/dispatch.rs` renders handlebars subject/body against a `{rule,
trigger, monitor}` context and delivers via the adapter for the channel kind
(email/SMTP, Slack, Discord, generic webhook), retrying 3× (1s→4s→16s) and
recording an `alerts` row with delivery status.

## 10. Pulsar event bus (optional)

`bus/` connects to Pulsar when `PULSAR_URL` is set; otherwise producers run in a
disabled no-op mode and the app boots normally (alerting escalations + the durable
webhook inbox are the only degraded features). Topics: `cc-webhooks` (the webhook
inbox; the consumer parses CC events → monitor state transitions → rules) and
`rule-escalations` (delayed delivery; the consumer re-evaluates the target rule).

## 11. Webhooks

`POST /webhooks/cc/:token` (token-authed, outside the rate limiter) enqueues the
raw CC body to Pulsar. The consumer dedups (cross-instance via `webhook_dedup`),
maps the event to a monitor effect (upsert/set-state/delete), writes history,
broadcasts a frame, and triggers rules.

## 12. MCP server

`mcp/` mounts an rmcp Streamable HTTP endpoint at `/mcp` (via `nest_service`, not
`route_service` — the latter breaks sibling route resolution when merged). Auth is
a Bearer `mpc_…` token checked against `users.mcp_token_hash` (sha256; raw token
shown once). The tool surface reuses the same `db`/`handlers` helpers as the REST
API; `user_id` always comes from the authenticated `McpAuth`, never from input.
An MCP client (Claude) can also create rules by calling the rule tools. Per-user
token management lives at `/api/mcp*`.

**Natural-language rule generation** (`rules/nl.rs`, `POST /api/rules/generate`)
uses a **local LM Studio** (OpenAI-compatible `chat/completions`) rather than
Anthropic: set `LMSTUDIO_BASE_URL` + `LMSTUDIO_MODEL` (optional
`LMSTUDIO_API_KEY`); the endpoint returns 400 when unset. The model is asked for a
JSON rule (the same condition/action schema). **The endpoint is kept but no
longer surfaced in the UI** (workflow creation is graph-editor-only;
`NaturalLanguageRule.tsx` stays on disk, unreferenced, for a possible return).

## 13. Metrics dashboard API

`domains/metrics/` serves `GET /api/metrics/{org}/{app}?panel&duration&bucket_span`
— bucketized historical series (cpu/memory/network/disk) for the ECharts panels in
the building drawer. Distinct from the poller's live "last point" path; reuses the
shared Warp10 token cache.

## 14. Frontend

`frontend/` is a Next.js 16 + React 19 App-Router app built as a **static export**
(`output: "export"` → `out/`) and served in production by **`frontend/server.mjs`**
(Express). `server.mjs` reverse-proxies `/api /auth /ws /webhooks /mcp /.well-known`
→ `BACKEND_INTERNAL_URL` (via `http-proxy-middleware`, with explicit WebSocket
`upgrade` tunnelling), so the browser only ever sees the frontend origin and the
WS is same-origin (avoids cross-site cookies). Two subtleties baked into
`server.mjs`: (1) explicit routes for `/docs` and `/login` because Next 16 emits
colliding `out/docs/` and `out/login/` directories that shadow the exported
`.html`; (2) a compression filter that skips binaries/Range so the Clever Cloud
HTTP/2 edge doesn't corrupt streamed `.bin/.png/.glb`.

The 3D city is the root shell (`/`), rendered client-only (`"use client"`,
`src/city/CityApp.tsx`). State boundary: **Zustand** for realtime/scene/UI
(`src/city/stores/*`), **React Query** for monitor server data
(`src/features/monitor/*`). Design system: the dark "Forge" palette with Clever
Cloud magenta accent; Plus Jakarta Sans + Rajdhani (brand fonts via `next/font`);
sonner toasts. The react-three-fiber scene (HexGrid/HexTile/BuildingEffects/
day-night/particles) and the `BuildingDrawer` overlays (Overview / Metrics
ECharts) mount inside the city shell. Rule authoring lives in the global
Workflows manager (TopBar → ⚙️ Workflows), not in the drawer; creating/editing
workflows is **builder-mode only**.

**Assets are served from Cellar (S3), not bundled.** Models/atlas/music/mayor
images load from `NEXT_PUBLIC_CDN_BASE_URL` (baked at build); when it is unset they
resolve same-origin from `frontend/public/`. The KayKit packs are **not in the
repository** (paid SOURCE editions): `npm run assets:install` extracts them from the
purchased zips into `public/assets/gltf/` (git-ignored), and `predev`/`prebuild` run
`npm run assets:check`, which fails fast when they are missing and no CDN is set —
see [`ASSETS.md`](ASSETS.md). Music and mayor portraits are optional (the Music
toggle hides itself when no track loads; portraits fall back to emoji). All KayKit models
share one texture atlas; the loader (`src/city/utils/assetLoader.ts`) swaps every
material's `.map` to it, so swapping the atlas re-skins the whole city (season
themes). Modals opened from the top bar/drawer are portalled to `document.body`
(the `.cc-panel` `backdrop-filter` otherwise traps `position:fixed`).

## 14.1 Features added after the merge

- **Custom (synthetic) monitored buildings.** Monitors with
  `kind='synthetic'`/`cc_resource_id NULL`, scoped to an org. `POST/DELETE
  /api/orgs/:id/monitors` create/remove them; `POST …/monitors/:id/state` sets a
  state manually (history source `manual` + broadcast). They flow into the rule
  editor's target list and `SetMonitorState` unchanged. In the city a cell carries
  `monitorId`; `assetIdForMonitorState` colours it (ok=green, warning=yellow,
  critical=red, unknown=scaffolding). Authored from the builder MappingPanel.
- **Notification channels UI** (`ChannelsModal`, top-bar 🔔) — CRUD over the
  existing `/api/channels` (email/slack/discord/webhook, type-specific config).
- **Scene templates** (`scene_templates` table, `/api/templates`, `TemplatesModal`,
  top-bar 🗺️). User-owned, private or public, **not org-scoped** (cross-org reuse
  needs no membership). A template stores tiles + decorations + decorative
  buildings (`toTemplateCells` strips app/addon/monitor bindings). Applying
  replaces the current org's map.
- **Per-scene settings** (`maps.settings` JSONB) — ambiance toggles
  (wind/water/day-night/particles/clouds/traffic/storage-props) **and** the season
  `theme`, applied on map load and saved on change
  (`useMapStore` ↔ `useAnimationStore`/`useAssetStore`).
- **City life: metric-driven traffic** (`TrafficSystem.tsx` + `three/useTraffic.ts`
  + `data/trafficAssets.ts` + `utils/roadGraph.ts`). An imperative pool of vehicle
  clones travels between bound buildings: population = baseline 2 + Σ of each
  resource's `netActivity` (capped 8 medieval / 6 space), destinations weighted by
  per-resource network activity, so a busy app visibly receives deliveries.
  `netActivity` is computed in `useRealtimeStore` from the frames' net rates
  (log-normalized against `NET_REF_BPS`, EMA over the 60s ticks). Vehicles are
  **composed** at spawn from catalog parts (medieval: horse + hitched cart
  attelages, lone rider horses; space: small-scaled spacetrucks on the ground,
  dropship/landers as shuttles cruising at `airAltitude`). Ground trips pathfind
  (A*, `roadGraph.ts`) over a graph where roads/tunnels cost 1, open terrain
  costs 3 (medieval roads-preferred, space rovers off-road-capable) and cells
  holding a building, any decoration, or water are **absent** — collision
  avoidance is by construction, there are no free curves through the map. Curves
  thread the shared-edge midpoints between consecutive cells so Catmull-Rom
  smoothing can't cut corners into neighbouring cells. Vehicles ride a right-hand
  `laneOffset` so opposing traffic passes side by side, with a two-ring
  vehicle-vehicle avoidance (slow at 0.8, hold at 0.38, spawn-order priority so
  exactly one of two crossing vehicles yields). Trips start/end on a traversable
  cell *adjacent* to the endpoint buildings. The graph is `useMemo`-cached on the
  copy-on-write `cells` Map; map edits despawn in-flight entities. All movement is
  delta-based (30 fps FrameLimiter-safe), entities cast no shadows.
- **City life: RAM/disk storage props** (`MetricProps.tsx` +
  `data/metricPropAssets.ts`, mounted from HexTile beside BuildingEffects —
  deliberately outside the building-clone effect so status flips don't rebuild
  props). RAM% quantized to tiers 0–5 (one crate/cargo slot per 20%, ≥90% adds an
  "overflowing" cluster with toppled barrels); disk% to tiers 0–4 (a resource
  depot growing per 25%). Slots are fixed polar offsets at radius ≤0.85 — strictly
  inside the cell, so neighbours can't collide. Clones are frozen
  (`matrixAutoUpdate=false`) and rebuilt only when a tier boundary is crossed.
- **Builder enhancements** — per-tile elevation (stacked `hex_grass_bottom`
  skirts), a Structures palette (walls/fences/bridges/grain/dirt/ruins), full
  auto-generated tile + decoration palettes, per-decoration rotation, click-to-move
  relocation, a hover name tooltip, and a sticky asset preview.
- **Render pipeline** — a soft IBL dome (`<Environment>` Lightformers, no remote
  HDRI) + matte materials + `@react-three/postprocessing` (N8AO + faint bloom +
  **Neutral** tone mapping) for the bright pastel look. Tune env/light intensity in
  `SceneCanvas.tsx` + `useDayNight.ts`.
- **Season texture themes** (Default/Summer/Fall/Winter) — the four KayKit atlas
  recolours on Cellar; `useAssetStore.setTheme` swaps the shared atlas across all
  cached models. Persisted per scene via `settings.theme`.
- **Workflows manager** (`WorkflowsModal`, top-bar ⚙️) — org-scoped manager for the
  user's rules (`GET /api/orgs/{org}/rules`; rules carry a `cc_org_id` tag derived
  from the monitors they watch). Lists each workflow with its enabled state and
  last outcome; actions: Edit (graph editor), Clone (copy created **disabled** so
  it can't double-fire), Enable/Disable, Delete, and **Diagnose** — a panel
  surfacing `/debug` (live per-leaf condition trace, referenced monitors/groups/
  channel health), `/test`, recent firings, and version restore. "+ New
  workflow" opens the graph editor directly (the Quick When/Then form was
  removed; the NL path is disabled in the UI, backend endpoint kept).
- **Rule editor live test overlay** (`RuleEditor` + `TestOverlayContext`) — the
  **Test** button serializes the drawn (possibly unsaved) graph and calls
  `POST /api/rules/test-draft`, then overlays the result on the ReactFlow canvas:
  per-condition `actual` values and true/false chips, AND/OR verdicts, edges on
  true paths lit/animated, matched/no-match on the RuleOutput node, would-run/
  skipped on actions, and a "true now, but not held for the duration yet" hint on
  `for_duration` leaves. The trace→node mapping uses a structural path map
  recorded during serialization (`serializeGraph`), so it stays exact even when
  incomplete nodes are dropped (those show "not included in test"). The overlay is
  cleared on any graph edit; edge highlighting is derived state, never written
  back. Editor ergonomics: a filter-as-you-type monitor/group picker
  (`ui/SearchableSelect`, `nodrag`/`nowheel` so typing doesn't drag the node), and
  an × delete button on condition/logical/action nodes.
- **Mayor "stocktake" loading notice** (`useMayorCityLoading`, mounted in
  `CityApp` beside `useMayorTips`). On opening a scene the buildings start grey
  ("unknown") until live frames arrive; this hook pins a Mayor notice — a
  dedicated `pinned` slot on `useMayorStore` that **bypasses the mute switch**
  and never auto-dismisses — with a live "N of TOTAL holdings have reported."
  count, until every resource-bound cell is **status-known and showing its true
  colour** (it reuses HexTile's `assetIdForStatus`/`assetIdForMonitorState` +
  `useAssetStore.hasModel`, and proactively `ensureColorLoaded`s the implied
  variants). Then it clears the pin and fires a verdict via `notify()` (respects
  mute): all-clear (`realmTrue`), `cityTrouble` if any app failed, or
  `realmPartial` at a 25s safety timeout. Live metrics are **not** gated on (idle
  apps emit no Warp10 series). Pairs with the on-connect immediate poll above so
  the wait is short. The old fixed-timer city-health check in `useMayorTips` was
  removed (this hook owns the verdict); onboarding tips queue behind the pin.

## 15. Build, run, test

```bash
# Dependencies (Postgres + Pulsar)
docker compose up -d                 # Postgres on host :5433, Pulsar on :6650

# Backend
cp .env.example .env                 # set ENCRYPTION_KEY + CC OAuth creds
cargo run -p myprettycloud-server    # migrations auto-apply; serves :8080
cargo test                           # unit tests (rule engine, metrics parse, …)
cargo clippy                         # lint (zero warnings expected)

# E2E-testing session-authenticated endpoints locally (no CC OAuth dance):
# run the server with ENCRYPTION_KEY=QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE=
# then seed a user + real session + critical monitor + CPU history and curl with
# the printed `mpc.sid` cookie. Local dev only.
cargo run --example seed_e2e

# Frontend  (static export → out/, served by server.mjs in prod)
cd frontend && npm install
npm run build                                            # → out/
BACKEND_INTERNAL_URL=http://localhost:8080 node server.mjs   # prod-like, :8080
npm run dev                                              # UI-only dev (no proxy)
```

Key backend env vars: `DATABASE_URL` (or `POSTGRESQL_ADDON_URI`), `ENCRYPTION_KEY`,
`CC_OAUTH_CONSUMER_KEY/SECRET`, `APP_URL`, `FRONTEND_URL`, optional `PULSAR_URL`,
`SMTP_*`, `SENTRY_DSN`, `WS_POLL_*`, and `LMSTUDIO_BASE_URL`/`LMSTUDIO_MODEL` for NL
rule generation. Frontend: `BACKEND_INTERNAL_URL` (proxy target) and
`NEXT_PUBLIC_CDN_BASE_URL` (Cellar asset base, baked at build). See `.env.example`.

## 16. Deployment (Clever Cloud)

Monorepo, **two CC apps** (backend + frontend), driven by the `clever` CLI:

```bash
# Backend (Rust)
clever create myprettycloud-backend --type rust --org $CC_ORGA --region par
clever env set PORT 8080
clever env set APP_FOLDER .
clever env set CC_RUST_BIN myprettycloud-server
clever config update --enable-force-https
clever scale --build-flavor M
clever addon create postgresql-addon ...   # + a Pulsar addon for full alerting
clever deploy

# Frontend (Node)
clever create myprettycloud-frontend --type node --org $CC_ORGA --region par
clever env set PORT 8080
clever env set APP_FOLDER ./frontend
clever env set CC_NODE_DEV_DEPENDENCIES install
clever env set CC_POST_BUILD_HOOK "npm --prefix ./frontend run build"
clever env set BACKEND_INTERNAL_URL <backend public url>
clever env set NEXT_PUBLIC_CDN_BASE_URL <cellar bucket url>   # assets, baked at build
clever config update --enable-force-https
clever scale --flavor nano --build-flavor S
```

Day-to-day the two apps are linked as aliases **`mpc-backend`** / **`mpc-frontend`**:
`clever deploy --alias mpc-backend` (deploy first when a migration/API changed —
migrations auto-apply on boot), then `clever deploy --alias mpc-frontend`. Both
enforce HTTPS; the frontend's `server.mjs` reverse-proxies the API (the backend URL
is never exposed to the browser) and tunnels the WebSocket. Postgres `LISTEN/NOTIFY`
powers the realtime bridge.

**Assets (Cellar/S3).** Models, the texture atlases (incl. seasonal recolours),
music and mayor images live in a Cellar bucket (`<your-bucket>`), served via
`NEXT_PUBLIC_CDN_BASE_URL`. Upload with **`s3cmd … --signature-v2`** (v4 hangs on
Cellar); credentials from `clever addon env <cellar-addon-id>`
(`CELLAR_ADDON_KEY_ID/SECRET/HOST`); objects under `assets/…`, public-read, with
CORS allowing the frontend origin. To (re)populate the `assets/gltf/…` keys, run
`npm run assets:install` locally and `s3cmd sync frontend/public/assets/
s3://<your-bucket>/assets/` (see [`ASSETS.md`](ASSETS.md) §4).

## 17. Conventions

- All code, comments, identifiers, and docs are in **English**.
- Errors: return `AppError`; upstream detail is logged, never leaked to clients.
- DB access goes through `db::*` repositories; handlers/tools stay thin.
- New org-scoped routes must call `validate_cc_id` + `require_org_member`.
- Producers emit realtime frames via `broadcast_via_pg`, never the local bus.
