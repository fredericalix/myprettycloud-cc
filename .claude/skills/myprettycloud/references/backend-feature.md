# Add a backend feature (table / repository / route / realtime)

All logic lives in `crates/core` (lib `mpc_core`); `crates/server/src/main.rs` only
wires things. Follow the existing layering — handlers stay thin, all DB access goes
through `db::*` repositories.

## New table

1. **Migration** — add `migrations/00NN_*.sql` (next number after the current max;
   check `ls migrations/` — e.g. if `0019_*` is highest, use `0020_`). Zero-padded
   4-digit prefix + `snake_case` description. The consolidated schema is applied by
   `sqlx::migrate!("../../migrations")` at boot (`crates/server/src/main.rs`) and on
   every Clever Cloud deploy of the backend.
2. **Repository** — `crates/core/src/db/<table>.rs`: a row struct deriving
   `#[derive(sqlx::FromRow)]` plus `async fn`s taking `&PgPool` (or `&mut PgConnection`)
   that own all SQL. Mirror an existing module like `db/users.rs` or `db/maps.rs`.
   Register it in `crates/core/src/db/mod.rs` with `pub mod <table>;`.

## New endpoint

3. **Handler** — a thin `async fn` in `crates/core/src/handlers/<area>.rs` (reuse an
   existing area file when it fits) returning `Result<Json<…>, AppError>`; it calls
   `db::*` repos and never embeds SQL. Expose a `pub fn router() -> Router<AppState>`
   in that module and re-export it in `crates/core/src/handlers/mod.rs`:
   ```rust
   pub use <area>::router as <area>_router;
   ```
4. **Mount** the router in the assembly in `crates/server/src/main.rs` (~line 205):
   ```rust
   let rest = Router::new()
       // …existing…
       .merge(mpc_core::handlers::<area>_router())
       .layer(governor_limiter);
   ```
5. **Auth** — pick the right guard:
   - **Org-scoped** routes MUST call `auth::authz::validate_cc_id` + `require_org_member`.
   - **User-scoped** routes use the `AuthUser` extractor; the user id is `auth.0.id`.

## Emitting realtime frames (optional)

6. Add a variant to the `WsFrame` enum in `crates/core/src/realtime/frame.rs`, then
   broadcast with `realtime::broadcast_via_pg(&state.db, cc_org_id, frame).await`
   (Postgres NOTIFY — multi-instance correct). **Never** push to the local bus
   directly. If the frontend consumes the frame, add the type to
   `frontend/src/city/types/ws.ts` and a matching arm in
   `useRealtimeStore.push` (`frontend/src/city/stores/useRealtimeStore.ts`).

## Conventions & verify

- English everywhere; return `AppError` (never leak upstream detail to clients).
- Verify: `cargo build` · `cargo clippy` (zero warnings) · `cargo test`. Then probe
  the new route unauthenticated and expect **401/403/400** (route exists), not 404/500.
- Depth: `docs/DEVELOPER_GUIDE.md` §5 (data model) and §8 (rule engine).
