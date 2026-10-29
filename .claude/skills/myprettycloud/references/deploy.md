# Deploy to Clever Cloud

Three apps, deployed with the `clever` CLI (v4) using the aliases in `.clever.json`:
`mpc-backend` (Rust), `mpc-frontend` (Node) and `mpc-website` (Astro docs/marketing
site). **Only deploy when explicitly asked**, and only with a green build.

**Docs-sync rule (mandatory):** if the frontend or backend change being deployed
alters user-facing behaviour, the docs MUST be updated in the same change —
`docs/USER_MANUAL.md` (the source manual) and the website mirror
(`website/src/content/docs/*.md`, plus `website/src/pages/tutorial.astro` when a
flow changed) — and **`mpc-website` deployed alongside** the app deploys. Skipping
the docs update/deploy makes the deploy incomplete.

`clever deploy` ships the current **git HEAD** — uncommitted work will NOT be
deployed. Commit first.

## Steps

1. **Backend gate** (from repo root):
   ```bash
   cargo build
   cargo clippy        # project bar: zero warnings (not -D-enforced, but keep it clean)
   cargo test          # rule-engine + parse unit tests
   ```
2. **Frontend gate** (must run from `frontend/`):
   ```bash
   cd frontend && npm run build   # next build, output:"export" → out/
   ```
3. **Website gate** (whenever the change touched docs or user-facing behaviour —
   per the docs-sync rule above):
   ```bash
   npm --prefix website run build   # astro build → website/dist/
   ```
4. **Commit** the change (so HEAD reflects what you'll deploy). The repo's workflow
   deploys from `main`.
5. **Deploy — backend first when a migration or the API changed** (migrations run on
   boot via `sqlx::migrate!`), then the frontend, then the website if docs changed:
   ```bash
   clever deploy --alias mpc-backend     # runs migrations on boot
   clever deploy --alias mpc-frontend
   clever deploy --alias mpc-website     # docs site — required when behaviour/docs changed
   ```
   If only static frontend changed, the frontend alone is fine. Each deploy prints
   "Application start successful" + "Successfully deployed" on success.
5. **Probe** the routes you touched/added, **unauthenticated**, to confirm they exist
   and didn't 500. A route that exists but requires auth/upgrade returns
   **401/403/400**, never 404; a genuinely missing route returns 404.
   ```bash
   # Through the public frontend (exercises the server.mjs proxy → backend):
   curl -s -o /dev/null -w "%{http_code}\n" \
     "https://myprettycloud-frontend.cleverapps.io/ws?org=<org-id>"
   # control — a route that should NOT exist:
   curl -s -o /dev/null -w "%{http_code}\n" \
     "https://myprettycloud-frontend.cleverapps.io/this-route-does-not-exist"   # → 404
   ```
   Expect the real route → 400/401/403 (route exists, healthy) and the control → 404.

## Identifiers

The real values live in the git-ignored `CLAUDE.local.md` (and `.clever.json` for the
aliases). Placeholders used in this guide:

- Org: `<org-id>`
- Backend app: `<backend-app-id>` (alias `mpc-backend`)
- Frontend app: `<frontend-app-id>` (alias `mpc-frontend`) → `https://myprettycloud-frontend.cleverapps.io`
- Website app: `<website-app-id>` (alias `mpc-website`) → `https://myprettycloud-website.cleverapps.io`

## Notes / gotchas

- The frontend is a **static export served by `frontend/server.mjs`**, which proxies
  `/api /auth /ws /webhooks /mcp /.well-known` → `BACKEND_INTERNAL_URL` and tunnels
  the WS upgrade. If you added a new top-level App-Router page, add an explicit
  `server.mjs` route (Next 16 emits colliding dirs that shadow the `.html`).
- View live logs with `clever logs --alias mpc-backend` (or `mpc-frontend`).
- zsh: unquoted `$VAR` does NOT word-split — inline flags or use arrays.
