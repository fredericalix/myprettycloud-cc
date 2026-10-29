# Work on the 3D city / scene

The city lives under `frontend/src/city/*`. Buildings are Clever Cloud resources,
coloured by their live status; the scene reacts to realtime frames over the WebSocket.

## State boundary

- **Zustand** for realtime/scene/UI state — `frontend/src/city/stores/*`
  (`useRealtimeStore`, `useMapStore`, `useAssetStore`, `useAnimationStore`,
  `useMayorStore`, `useOrgStore`).
- **React Query** for monitor/server data — `frontend/src/features/monitor/*`.
- City API client = `frontend/src/city/api/*` via `api()` (`credentials:'include'`);
  the monitor side uses `apiFetch` (`frontend/src/lib/api.ts`).

## Realtime → status colour pipeline

1. Backend broadcasts a `WsFrame` (see `references/backend-feature.md`).
2. `frontend/src/city/types/ws.ts` types it; `city/ws/useWsClient.ts` receives it and
   calls `useRealtimeStore.push(frame)`, which keys live state by resource id
   (`apps` / `addons` / `monitors`).
3. `components/scene/HexTile.tsx` reads the bound resource's state and picks the
   coloured GLTF variant via `utils/statusVisual.ts`:
   - apps/add-ons → `assetIdForStatus` (running=green, deploying=blue,
     failed/warning=red, **unknown=yellow**, created/stopped=`building_stage_B`);
   - synthetic monitor cells → `assetIdForMonitorState` (ok=green, warning=yellow,
     critical=red, else=`building_stage_B`).
4. `useAssetStore.cloneModel` / `hasModel` / `ensureColorLoaded` supply the model;
   colour variants beyond the initial one are **lazy-loaded** (a scaffold shows until
   the batch arrives).

## Assets & themes

- All KayKit models share **ONE texture atlas**; `utils/assetLoader.ts` swaps every
  material's `.map` to it — so swapping that one texture re-skins the whole city.
  Season themes do exactly this: `assets/gltf/tiles/base/hexagons_medieval{""|_Summer|
  _Fall|_Winter}.png`, applied via `useAssetStore.setTheme`.
- The full kit is catalogued in `data/assetCatalog.ts` (`extractColor`,
  `parseBuildingId`).
- Assets load from `NEXT_PUBLIC_CDN_BASE_URL` via `cdnUrl()` (`utils/cdn.ts`) — Cellar
  in prod. To add/replace asset files, see `references/cellar-assets.md`.

## DOM / overlay rules

- Heavy DOM (ECharts, ReactFlow) must **never** mount inside the R3F `<Html>`
  projection. Modals opened from the top bar / drawer are **portalled to
  `document.body`** (the `.cc-panel` `backdrop-filter` otherwise traps
  `position:fixed`) — reuse the `rule-modal-backdrop` / `rule-modal-panel` classes.
- A new top-level App-Router page needs an explicit `frontend/server.mjs` route.

## The mayor

`useMayorStore` (queue/current/history + a `pinned` slot that bypasses mute),
`components/mayor/MayorPopup.tsx`, `mayor/mayorMessages.ts`, and the
`useMayorTips` / `useMayorCityLoading` hooks (the latter pins a scene-loading notice
until every bound building is status-known and coloured).

## Adding a new frame type

Backend (`frame.rs` + `broadcast_via_pg`) → frontend `types/ws.ts` +
`useRealtimeStore.push` arm + a consumer (`HexTile`, an overlay, or the mayor).

## Verify

Per-scene settings (ambiance + season theme) persist in `maps.settings` (JSONB),
applied on map load (`useMapStore` ↔ `useAnimationStore` / `useAssetStore`). Build
with `npm run build` from `frontend/`. Depth: `docs/DEVELOPER_GUIDE.md` §13–14.
