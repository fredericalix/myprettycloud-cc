# Upload assets to Cellar (S3)

GLTF models, the texture atlas (+ season recolours), music, and the mayor images live
on Cellar, **not** in `public/`. Bucket **`<your-bucket>`** (real name in `CLAUDE.local.md`), keys under
`assets/…` (and `mayor/…` for the mayor PNGs). The frontend loads them from
`NEXT_PUBLIC_CDN_BASE_URL` via `cdnUrl()` (`frontend/src/city/utils/cdn.ts`), baked at
build time.

The KayKit models are **not in the repo** (paid SOURCE packs, see `docs/ASSETS.md`).
To get a local copy of the `assets/gltf/…` tree (e.g. to re-sync the bucket), run
`npm --prefix frontend run assets:install` — it reads
`KayKit_Medieval_Hexagon_Pack_1.0_SOURCE.zip` / `KayKit_Space_Base_Bits_1.0_SOURCE.zip`
from `~/Downloads` into `frontend/public/assets/gltf/` (git-ignored). Never commit them.

## Get credentials (never hardcode or commit them)

Find the Cellar addon, then read its env into your shell:

```bash
clever addon list                       # find the Cellar addon id (addon_…)
clever addon env <cellar-addon-id>      # prints CELLAR_ADDON_KEY_ID / _SECRET / _HOST
```

## Upload with s3cmd — use `--signature-v2`

Signature **v4 hangs on Cellar**; always pass `--signature-v2`. Example (put a
recoloured atlas; set the right `--mime-type`):

```bash
s3cmd put hexagons_medieval_Winter.png \
  s3://<your-bucket>/assets/gltf/tiles/base/hexagons_medieval_Winter.png \
  --signature-v2 \
  --access_key="$CELLAR_ADDON_KEY_ID" \
  --secret_key="$CELLAR_ADDON_SECRET" \
  --host="$CELLAR_ADDON_HOST" \
  --host-bucket="%(bucket)s.$CELLAR_ADDON_HOST" \
  --mime-type="image/png"
```

Use `--mime-type="model/gltf-binary"` for `.glb`, `application/octet-stream` for
`.bin`, `audio/mpeg` for music. `s3cmd sync <dir>/ s3://<your-bucket>/assets/…`
works for batches (same auth flags).

## When changes take effect

- New/replaced keys **under the existing CDN base** are served immediately and loaded
  by URL at runtime — **no rebuild needed**.
- Changing `NEXT_PUBLIC_CDN_BASE_URL` itself (the base) requires a **frontend rebuild +
  deploy** because it's baked at build time (see `references/deploy.md`).

## Gotchas

- Replacing the shared atlas **re-skins the whole city** (that's the season-theme
  mechanism) — see `references/city-scene.md`.
- `frontend/server.mjs` skips compression for binaries/Range so the Clever Cloud HTTP/2
  edge doesn't corrupt `.bin/.png/.glb`; serve assets with correct content types.
- zsh: unquoted `$VAR` does NOT word-split — keep the quoted flags above or use an array.
