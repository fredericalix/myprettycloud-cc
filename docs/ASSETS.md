# 3D assets — buying and installing the KayKit packs

myprettycloud draws your infrastructure as a 3D city. Every model in that city —
buildings, tiles, trees, carts, the space station — comes from two asset packs by
**[Kay Lousberg](https://www.kaylousberg.com)** (KayKit). **These assets are not
included in this repository.** To run the city you buy the packs on itch.io and
install them with one command.

This guide covers buying the packs, installing them, checking the install, deploying
to production, the optional music and portraits, and troubleshooting.

---

## Why the assets are not bundled

The code of myprettycloud is open source (AGPL-3.0). The art is not ours. Kay
Lousberg releases KayKit under CC0, which would technically allow redistribution.
We still choose **not** to redistribute the files: the paid *Source Files*
editions are how Kay funds this work, and an observability tool that is nice to
look at owes a lot to it. Buying the two packs costs a few dollars and is the
only requirement for running the city.

> The AGPL-3.0 license of this repository covers the myprettycloud code only. It
> does **not** cover the KayKit assets, the ambient music or the mayor portraits.

---

## 1. Buy and download the two packs

You need the **Source Files** edition of both packs. The installer checks for it and
rejects other editions.

| Pack | Store page | Archive to download |
|---|---|---|
| KayKit Medieval Hexagon Pack | <https://kaylousberg.itch.io/kaykit-medieval-hexagon> | `KayKit_Medieval_Hexagon_Pack_1.0_SOURCE.zip` |
| KayKit Space Base Bits | <https://kaylousberg.itch.io/space-base-bits> | `KayKit_Space_Base_Bits_1.0_SOURCE.zip` |

For each pack:

1. Open the store page and click **Buy Now**.
2. Pick the **Source Files** option (at the time of writing, $8 for the Medieval
   Hexagon Pack) and complete the payment.
3. On the download page itch.io shows after purchase (also available later under
   *My Library* on itch.io), download the archive whose name ends in `_SOURCE.zip`.
4. Leave it in your **Downloads** folder. The installer looks there first.

> Do not unzip the archives yourself. The installer reads the `.zip` directly and
> extracts only the files it needs (about 26 MB out of the ~75 MB of archives).

---

## 2. Install

### Prerequisites

- **Node.js 20+** (already required to build the frontend).
- **`unzip`**, or **`tar`** with zip support:
  - macOS: both are preinstalled.
  - Debian/Ubuntu: `sudo apt install unzip`. Fedora: `sudo dnf install unzip`.
  - Windows 10+: the built-in `tar.exe` (bsdtar) handles zip, so nothing to install.
    WSL works like Linux.

### Run the installer

```bash
cd frontend
npm install            # if not done yet
npm run assets:install
```

The installer:

1. **Finds the archives.** It looks in `~/Downloads`, then the repository root,
   then the current directory, by their exact file names.
2. **Checks that each archive is the SOURCE edition.** The expected top-level folder
   and the Blender source file (`SOURCE/*.blend`) must be present.
3. **Compares the SHA-256** with the known 1.0 release. A mismatch only prints a
   warning: a re-zipped or newer archive is accepted if its content is complete.
4. **Extracts only `Assets/gltf/`** to a temporary directory. Archives that contain
   unsafe paths (absolute paths or `..`) are rejected.
5. **Copies the files into `frontend/public/assets/gltf/`**, replacing any previous
   install of that pack:
   - Medieval pack → `assets/gltf/{buildings,decoration,tiles,units}/`
   - Space pack → `assets/gltf/space/`
6. **Verifies the result.** Every model listed in the asset catalogs
   (`src/city/data/assetCatalog.ts`, `spaceAssetCatalog.ts`) must be present, along
   with every `.bin` buffer and texture each model references and the four season
   atlases.

Expected output:

```text
[assets] KayKit Medieval Hexagon Pack (SOURCE)
         ← /Users/you/Downloads/KayKit_Medieval_Hexagon_Pack_1.0_SOURCE.zip
[assets] ✓ installed 829 files (23.4 MB) → public/assets/gltf
[assets] KayKit Space Base Bits (SOURCE)
         ← /Users/you/Downloads/KayKit_Space_Base_Bits_1.0_SOURCE.zip
[assets] ✓ installed 139 files (2.4 MB) → public/assets/gltf/space

[assets] All set. Next: `npm run dev` (or `npm run build`).
```

### Options

```bash
# Archives stored somewhere else
npm run assets:install -- --medieval ~/stuff/KayKit_Medieval_Hexagon_Pack_1.0_SOURCE.zip \
                          --space    ~/stuff/KayKit_Space_Base_Bits_1.0_SOURCE.zip

# Reinstall even if everything is already in place
npm run assets:install -- --force
```

Running the installer again is safe. A pack that is already complete is skipped
unless you pass `--force` or an explicit `--medieval` / `--space` path.

The installed files live in `frontend/public/assets/`, which is **git-ignored**. Never
commit them.

---

## 3. Check the install

```bash
npm run assets:check
```

```text
[assets] ✓ KayKit Medieval Hexagon Pack (SOURCE)
[assets] ✓ KayKit Space Base Bits (SOURCE)
```

The same check runs automatically before `npm run dev` and `npm run build`
(`predev` / `prebuild`). If the assets are missing, the command stops with a message
that points back to this guide, so you never get a grey, model-less city by accident.

Then start the app (see the [README](../README.md) quick start), open a city and
check that:

- the medieval town shows its buildings, and the season picker (Summer / Fall /
  Winter) re-skins the whole map;
- a space map shows the station modules;
- the browser console shows no `404` or glTF parse error for `.gltf`, `.bin` or `.png` files.

---

## 4. Production / self-hosting

The frontend is a static export (`next build` → `frontend/out/`) served by
`frontend/server.mjs`. Choose one of two ways to serve the assets.

### Option A — bundle them with the frontend (simplest)

Leave `NEXT_PUBLIC_CDN_BASE_URL` **unset**. `next build` copies `public/` into `out/`,
so the models are served by `server.mjs` from the same origin. The deployed app is
about 26 MB larger.

This works when you **build on a machine where the assets are installed**: your
laptop, a CI job that runs `npm run assets:install` (store the two archives as
private CI artifacts, never in a public place), or a Docker image built locally.

> Platforms that build **from your git repository** (Clever Cloud, Heroku, Render…)
> do not receive the git-ignored `public/assets/`. Their build stops at the
> `prebuild` check. Use option B for them.

### Option B — serve them from a bucket / CDN

1. Install the assets locally (`npm run assets:install`).
2. Upload `frontend/public/assets/` to an S3-compatible bucket under the key prefix
   `assets/`. Keep the same tree, so you end up with
   `<bucket>/assets/gltf/buildings/blue/building_castle_blue.gltf`, and so on.
   Example with `s3cmd` (on Clever Cloud Cellar, add `--signature-v2`: signature v4
   hangs there):

   ```bash
   s3cmd sync frontend/public/assets/ s3://<your-bucket>/assets/ \
     --acl-public --guess-mime-type
   ```

3. Make the objects **publicly readable** and allow your frontend origin in the
   bucket's **CORS** policy (`GET`, `HEAD`).
4. Set `NEXT_PUBLIC_CDN_BASE_URL` to the bucket's public base URL **before
   building** (it is baked into the bundle at build time), for example
   `https://<your-bucket>.cellar-c2.services.clever-cloud.com`.

When `NEXT_PUBLIC_CDN_BASE_URL` is set (in the environment or a `frontend/.env*` file),
the asset check is skipped, because the files are expected on the CDN.

Licensing note: serving the files to your users at runtime is normal use of the
packs. Do not offer the raw archives or a browsable dump of the files for download.

---

## 5. Optional: ambient music and mayor portraits

The ambient music and the mayor / commandant portraits used on the hosted instance
are **not** part of the open-source release. Without them the app still works:

- the **Music** button in the top bar hides itself once no track can be loaded;
- the mayor's speech bubble shows an emoji (🧐 😄 😱) instead of a portrait.

To add your own, drop files with these exact names into `frontend/public/` (or
under the same keys on your CDN). Both folders are git-ignored.

```text
frontend/public/music/        Castle Ember.mp3, Castle Ember2.mp3,
                              Cobblestone Noon.mp3, Cobblestone Noon2.mp3,
                              First Village.mp3, First Village2.mp3      ← medieval maps
                              Orbital Drift.mp3, Orbital Drift2.mp3,
                              Dustline Drift.mp3, Dustline Drift2.mp3,
                              Red Dust Launch.mp3                         ← space maps
frontend/public/mayor/        mayor_{neutral,happy,alarmed}.png           ← medieval maps
                              commandant_{neutral,happy,alarmed}.png      ← space maps
```

The track lists live in `src/city/hooks/useAmbientMusic.ts`. Edit them if you want
other file names.

---

## 6. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `… not found (looked in ~/Downloads, the repo root and the current directory)` | The archive has a different name or location. Pass its path with `--medieval <zip>` / `--space <zip>`. |
| `this is not the SOURCE edition of the pack` | You downloaded the free or another edition. Get the **Source Files** archive from your itch.io library. |
| `does not look like KayKit_…_SOURCE.zip` | Wrong archive for that flag (for example the space zip passed to `--medieval`), or a re-packed archive with a different top-level folder. Use the original download. |
| `! checksum differs from the known 1.0 SOURCE archive` | Warning only. The archive was re-zipped or is a newer release. The install goes on, and the file check that follows decides. |
| `N required file(s) still missing after install` | A newer pack version renamed or removed models used by the catalogs. Open an issue with the missing path. |
| `neither unzip nor tar is available` | Install `unzip` (see prerequisites). |
| `npm run dev` / `build` stops with `[assets] ✗ …` | Assets not installed: run `npm run assets:install`. For a CDN setup, set `NEXT_PUBLIC_CDN_BASE_URL`. |
| City stays empty or grey, console shows `404 …gltf` or a glTF/JSON parse error (`server.mjs` answers unknown paths with the app's HTML) | With a CDN: the files are not under `<base>/assets/gltf/…`, are not public, or CORS blocks your origin. Without a CDN: `NEXT_PUBLIC_CDN_BASE_URL` was set at build time. Rebuild without it. |
| Models load but are untextured / pink | A texture atlas (`hexagons_medieval*.png`, `spacebits_texture.png`) is missing or served with a wrong content type. Re-run with `--force` and check your CDN MIME types. |
