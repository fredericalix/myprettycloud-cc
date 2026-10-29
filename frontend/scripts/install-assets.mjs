#!/usr/bin/env node
// Installs the KayKit 3D assets from the archives you bought on itch.io into
// frontend/public/assets/gltf (git-ignored). See docs/ASSETS.md.
//
//   npm run assets:install                      # auto-detect in ~/Downloads, repo root, cwd
//   npm run assets:install -- --medieval <zip> --space <zip>
//   npm run assets:install -- --force           # reinstall even if already complete
//
// Only the SOURCE editions are accepted. No npm dependency: extraction uses the
// system `unzip` (macOS / Linux) or `tar` (bsdtar — Windows 10+, macOS).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PACKS, PUBLIC_DIR, missingAssets } from './check-assets.mjs';

const REPO_ROOT = path.resolve(PUBLIC_DIR, '..', '..');

function fail(msg) {
  console.error(`[assets] ✗ ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { force: false, medieval: null, space: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') opts.force = true;
    else if (a === '--medieval' || a === '--space') {
      const v = argv[++i];
      if (!v) fail(`${a} expects a path to the .zip archive`);
      opts[a.slice(2)] = path.resolve(v.replace(/^~(?=$|\/)/, os.homedir()));
    } else if (a === '-h' || a === '--help') {
      console.log('Usage: npm run assets:install -- [--medieval <zip>] [--space <zip>] [--force]');
      process.exit(0);
    } else fail(`unknown argument: ${a}`);
  }
  return opts;
}

function findArchive(pack, explicit) {
  if (explicit) {
    if (!fs.existsSync(explicit)) fail(`archive not found: ${explicit}`);
    return explicit;
  }
  const dirs = [path.join(os.homedir(), 'Downloads'), REPO_ROOT, process.cwd()];
  return dirs.map((d) => path.join(d, pack.archive)).find((p) => fs.existsSync(p)) ?? null;
}

// --- archive tooling (system unzip, else bsdtar) ---------------------------

const hasUnzip = spawnSync('unzip', ['-v'], { stdio: 'ignore' }).status === 0;
const hasTar = spawnSync('tar', ['--version'], { stdio: 'ignore' }).status === 0;

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) fail(`${cmd} ${args[0]} failed: ${(r.stderr || r.error?.message || '').trim()}`);
  return r.stdout;
}

function listEntries(zip) {
  const out = hasUnzip ? run('unzip', ['-Z1', zip]) : run('tar', ['-tf', zip]);
  return out.split(/\r?\n/).filter(Boolean);
}

function extractDir(zip, dirInZip, dest) {
  if (hasUnzip) run('unzip', ['-q', '-o', zip, `${dirInZip}/*`, '-d', dest]);
  else run('tar', ['-xf', zip, '-C', dest, dirInZip]);
}

function sha256(file) {
  const hash = createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(1 << 20);
  let n;
  while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) hash.update(buf.subarray(0, n));
  fs.closeSync(fd);
  return hash.digest('hex');
}

/** Some archive folders are stored read-only (e.g. tiles/*\/waterless) and
 *  unzip preserves that, which breaks later cleanup — normalise to 755/644. */
function makeWritable(dir) {
  fs.chmodSync(dir, 0o755);
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) makeWritable(p);
    else if (e.isFile()) fs.chmodSync(p, 0o644);
  }
}

function dirStats(dir) {
  let files = 0;
  let bytes = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!e.isFile()) continue;
    files++;
    bytes += fs.statSync(path.join(e.parentPath, e.name)).size;
  }
  return { files, bytes };
}

// --- install one pack -------------------------------------------------------

function install(key, pack, zip) {
  console.log(`[assets] ${pack.name}\n         ← ${zip}`);

  const entries = listEntries(zip);
  if (entries.some((e) => e.startsWith('/') || /^[A-Za-z]:/.test(e) || e.split(/[\\/]/).includes('..'))) {
    fail('archive contains unsafe paths (absolute or "..") — refusing to extract it.');
  }
  const gltfDir = `${pack.root}/Assets/gltf`;
  if (!entries.some((e) => e.startsWith(`${gltfDir}/`))) {
    fail(`${path.basename(zip)} does not look like ${pack.archive} (no ${gltfDir}/ inside).`);
  }
  if (!entries.includes(`${pack.root}/${pack.sourceMarker}`)) {
    fail(`this is not the SOURCE edition of the pack (${pack.sourceMarker} is missing).
  Buy the "Source Files" edition at ${pack.url}`);
  }
  if (sha256(zip) !== pack.sha256) {
    console.warn('[assets] ! checksum differs from the known 1.0 SOURCE archive (re-zipped or newer release?) — continuing, files are verified below.');
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `mpc-assets-${key}-`));
  try {
    extractDir(zip, gltfDir, tmp);
    makeWritable(tmp);
    const src = path.join(tmp, gltfDir);
    const dest = path.join(PUBLIC_DIR, pack.target);

    // Clean replace of the directories this pack owns, then copy.
    for (const d of pack.owns ?? ['']) fs.rmSync(path.join(dest, d), { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      if (pack.owns && !pack.owns.includes(name)) continue;
      fs.cpSync(path.join(src, name), path.join(dest, name), { recursive: true });
    }

    const missing = missingAssets(pack);
    if (missing.length > 0) {
      fail(`${missing.length} required file(s) still missing after install, e.g. public/${missing[0]}`);
    }
    const stats = (pack.owns ?? ['']).map((d) => dirStats(path.join(dest, d)));
    const files = stats.reduce((n, s) => n + s.files, 0);
    const mb = stats.reduce((n, s) => n + s.bytes, 0) / 1e6;
    console.log(`[assets] ✓ installed ${files} files (${mb.toFixed(1)} MB) → public/${pack.target}`);
  } finally {
    // Best effort: a leftover temp dir must not fail an otherwise good install.
    try {
      fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      console.warn(`[assets] ! could not remove temp dir ${tmp}`);
    }
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!hasUnzip && !hasTar) fail('neither `unzip` nor `tar` is available — install one of them (see docs/ASSETS.md).');

  const notFound = [];
  for (const [key, pack] of Object.entries(PACKS)) {
    if (!opts.force && !opts[key] && missingAssets(pack).length === 0) {
      console.log(`[assets] ✓ ${pack.name} already installed (use --force to reinstall)`);
      continue;
    }
    const zip = findArchive(pack, opts[key]);
    if (!zip) {
      notFound.push(pack);
      continue;
    }
    install(key, pack, zip);
  }

  if (notFound.length > 0) {
    console.error('');
    for (const pack of notFound) {
      console.error(`[assets] ✗ ${pack.archive} not found (looked in ~/Downloads, the repo root and the current directory).
    Buy the "Source Files" edition at ${pack.url}
    then re-run, or pass its location: --${Object.keys(PACKS).find((k) => PACKS[k] === pack)} <path/to/${pack.archive}>`);
    }
    console.error('\nFull guide: docs/ASSETS.md');
    process.exit(1);
  }
  console.log('\n[assets] All set. Next: `npm run dev` (or `npm run build`).');
}

main();
