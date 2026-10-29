#!/usr/bin/env node
// Verifies that the KayKit 3D assets the city needs are installed under
// frontend/public/assets/gltf. They are NOT part of the repository (see
// docs/ASSETS.md): install them with `npm run assets:install`.
//
// The required file list is read from the asset catalogs themselves, so it can
// never drift from what the app actually loads. When NEXT_PUBLIC_CDN_BASE_URL
// is set, the assets are served from that CDN instead and this check passes.
//
// Also imported by install-assets.mjs (exports `missingAssets`, `PACKS`).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC_DIR = path.join(FRONTEND_DIR, 'public');
const DATA_DIR = path.join(FRONTEND_DIR, 'src', 'city', 'data');

/** The two KayKit packs, in their paid SOURCE edition. */
export const PACKS = {
  medieval: {
    name: 'KayKit Medieval Hexagon Pack (SOURCE)',
    url: 'https://kaylousberg.itch.io/kaykit-medieval-hexagon',
    archive: 'KayKit_Medieval_Hexagon_Pack_1.0_SOURCE.zip',
    root: 'KayKit_Medieval_Hexagon_Pack_1.0_SOURCE',
    sourceMarker: 'SOURCE/Medieval_Hexagons_SOURCE.blend',
    sha256: 'abf18dddf87e70f61617af1aa7463d012d95dca70764cbf5d49a5e30504733e7',
    // Archive `<root>/Assets/gltf/<x>` → `public/assets/gltf/<x>`.
    target: 'assets/gltf',
    // Sub-directories of `target` owned by this pack (wiped on reinstall).
    owns: ['buildings', 'decoration', 'tiles', 'units'],
    catalog: 'assetCatalog.ts',
    // Loaded by path in assetLoader.ts (season themes), not via the catalog.
    extra: ['', '_Summer', '_Fall', '_Winter'].map(
      (s) => `assets/gltf/tiles/base/hexagons_medieval${s}.png`,
    ),
  },
  space: {
    name: 'KayKit Space Base Bits (SOURCE)',
    url: 'https://kaylousberg.itch.io/space-base-bits',
    archive: 'KayKit_Space_Base_Bits_1.0_SOURCE.zip',
    root: 'KayKit_Space_Base_Bits_1.0_SOURCE',
    sourceMarker: 'SOURCE/SpaceBaseBits_SOURCE.blend',
    sha256: 'bbaf40175a2fc6f8615d93b501cac775d7061fc6a6885b1b4410aecb758aedae',
    target: 'assets/gltf/space',
    owns: null, // owns the whole target directory
    catalog: 'spaceAssetCatalog.ts',
    extra: ['assets/gltf/space/spacebits_texture.png'],
  },
};

/** Asset paths (relative to public/) listed in a pack's catalog + its extras. */
export function requiredAssets(pack) {
  const src = fs.readFileSync(path.join(DATA_DIR, pack.catalog), 'utf8');
  const base = src.match(/const P = '([^']+)'/)?.[1];
  const paths = new Set(pack.extra);
  for (const m of src.matchAll(/path:\s*['`]([^'`]+)['`]/g)) {
    paths.add(m[1].replace('${P}', base ?? '${P}'));
  }
  return [...paths];
}

/** Missing files for a pack: catalog entries plus the buffers/images each
 *  installed .gltf references (a .gltf without its .bin still fails to load). */
export function missingAssets(pack) {
  const missing = [];
  for (const rel of requiredAssets(pack)) {
    const abs = path.join(PUBLIC_DIR, rel);
    if (!fs.existsSync(abs)) {
      missing.push(rel);
      continue;
    }
    if (!rel.endsWith('.gltf')) continue;
    let gltf;
    try {
      gltf = JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch {
      missing.push(`${rel} (unreadable)`);
      continue;
    }
    for (const { uri } of [...(gltf.buffers ?? []), ...(gltf.images ?? [])]) {
      if (!uri || uri.startsWith('data:')) continue;
      const dep = path.posix.join(path.posix.dirname(rel), decodeURIComponent(uri));
      if (!fs.existsSync(path.join(PUBLIC_DIR, dep))) missing.push(dep);
    }
  }
  return missing;
}

/** NEXT_PUBLIC_CDN_BASE_URL from the environment or any of the .env files Next
 *  loads (this script runs before Next, so it reads them itself). */
function cdnBaseConfigured() {
  if (process.env.NEXT_PUBLIC_CDN_BASE_URL) return true;
  const files = ['.env', '.env.local', '.env.development', '.env.development.local', '.env.production', '.env.production.local'];
  return files.some((f) => {
    try {
      const src = fs.readFileSync(path.join(FRONTEND_DIR, f), 'utf8');
      return /^\s*(?:export\s+)?NEXT_PUBLIC_CDN_BASE_URL\s*=\s*['"]?[^'"\s#]/m.test(src);
    } catch {
      return false;
    }
  });
}

function main() {
  if (cdnBaseConfigured()) {
    console.log('[assets] NEXT_PUBLIC_CDN_BASE_URL is set — assets are served from the CDN, skipping local check.');
    return;
  }
  let ok = true;
  for (const pack of Object.values(PACKS)) {
    const missing = missingAssets(pack);
    if (missing.length === 0) {
      console.log(`[assets] ✓ ${pack.name}`);
      continue;
    }
    ok = false;
    console.error(`[assets] ✗ ${pack.name}: ${missing.length} file(s) missing, e.g. public/${missing[0]}`);
  }
  if (!ok) {
    console.error(`
The 3D assets are not bundled with this repository. To install them:
  1. Buy the "Source Files" edition of both KayKit packs (supports the artist):
       ${PACKS.medieval.url}
       ${PACKS.space.url}
  2. Download ${PACKS.medieval.archive}
       and ${PACKS.space.archive}
  3. Run:  npm run assets:install   (from frontend/)

Full guide: docs/ASSETS.md`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
