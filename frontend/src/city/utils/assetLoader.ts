import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { type BuildingColor, getAlwaysLoadedAssets, getAssetsByColor } from '../data/assetCatalog';
import { SPACE_ASSET_CATALOG } from '../data/spaceAssetCatalog';
import type { AssetEntry } from '../types/map';
import type { Kit } from '../types/kit';
import { CDN_BASE } from './cdn';
import { debug } from './debug';
import { retryWithBackoff } from './retry';

// Bump this when the asset catalogue (gltf/bin/png on disk) changes in a
// breaking way. Appended as `?v=N` to every asset URL — GLTFs we name
// directly, and `.bin`/`.png` referenced from inside .gltf via the loader's
// URL modifier (those URIs are resolved by GLTFLoader internally and would
// otherwise miss the cache-bust). Static-asset paths aren't content-hashed
// by Vite, so this is the only reliable way to retire a previous deploy's
// files from browser/proxy caches that pinned them under `immutable`.
const ASSET_VERSION = '3';

function appendVersion(url: string): string {
  // Absolute URLs (blob:, data:, or already-CDN) pass through untouched.
  if (/^[a-z]+:/i.test(url)) return url;
  // Cache-bust relative asset URLs (gltf + their child .bin/.png), then route
  // them to the Cellar CDN when configured. S3 ignores the ?v query for object
  // lookup, so the bust still busts the browser cache without 404ing.
  const busted = url.includes('?v=')
    ? url
    : `${url}${url.includes('?') ? '&' : '?'}v=${ASSET_VERSION}`;
  return CDN_BASE ? `${CDN_BASE}/${busted.replace(/^\//, '')}` : busted;
}

function makeLoadingManager(): THREE.LoadingManager {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(appendVersion);
  return manager;
}

function makeGltfLoader(manager: THREE.LoadingManager): GLTFLoader {
  const loader = new GLTFLoader(manager);
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

/** Seasonal atlas variants — same UV layout, recoloured. Empty suffix = default. */
export const THEME_SUFFIX: Record<string, string> = {
  default: '',
  Summer: '_Summer',
  Fall: '_Fall',
  Winter: '_Winter',
};
export const THEMES = ['default', 'Summer', 'Fall', 'Winter'] as const;

/** Load one season's shared atlas (routed to the CDN + cache-busted via the
 *  loading manager), configured exactly like the default atlas. */
export async function loadAtlas(theme: string): Promise<THREE.Texture> {
  return loadSharedTexture(`assets/gltf/tiles/base/hexagons_medieval${THEME_SUFFIX[theme] ?? ''}.png`);
}

/** The shared texture for a kit. Medieval = the seasonal hex atlas; space =
 *  the single Space Base Bits palette (seasons don't apply). */
export async function loadKitTexture(kit: Kit, theme: string): Promise<THREE.Texture> {
  if (kit === 'space') return loadSharedTexture('assets/gltf/space/spacebits_texture.png');
  return loadAtlas(theme);
}

async function loadSharedTexture(path: string): Promise<THREE.Texture> {
  const manager = makeLoadingManager();
  const textureLoader = new THREE.TextureLoader(manager);
  const tex = await textureLoader.loadAsync(path);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

async function loadEntries(
  entries: AssetEntry[],
  gltfLoader: GLTFLoader,
  sharedTexture: THREE.Texture,
  onItem?: () => void,
): Promise<Map<string, GLTF>> {
  const cache = new Map<string, GLTF>();
  const batchSize = 8;
  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (entry) => {
        try {
          // Retry covers the .gltf fetch AND its child .bin/.png fetches —
          // GLTFLoader resolves them inside loadAsync, so a child-fetch failure
          // surfaces as a top-level rejection.
          const gltf = await retryWithBackoff(() => gltfLoader.loadAsync(entry.path), {
            attempts: 3,
            baseDelayMs: 300,
            scope: `asset:${entry.id}`,
          });
          gltf.scene.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              const mat = child.material as THREE.MeshStandardMaterial;
              if (mat.map && mat.map !== sharedTexture) {
                mat.map.dispose();
                mat.map = sharedTexture;
              }
              // Flat, matte look (kills the 0.5 sheen) and let the soft IBL
              // dome light every face evenly → the bright pastel render.
              // Transparent materials keep their own look (the space dome's
              // glass is roughness 0.1 / opacity 0.1 — matting it kills it).
              if (!mat.transparent) {
                mat.metalness = 0;
                mat.roughness = 0.9;
              }
              mat.envMapIntensity = 1;
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });
          cache.set(entry.id, gltf);
        } catch (e) {
          debug.error('asset', `gave up loading "${entry.id}" from ${entry.path}`, e);
        }
        onItem?.();
      }),
    );
  }
  return cache;
}

/** Initial load for a kit.
 *  Medieval: every non-color asset + one dominant color of building variants
 *  (other colors fetched on-demand by `useAssetStore.ensureColorLoaded`).
 *  Space: the whole pack (69 small GLTFs, no color variants). */
export async function loadInitialAssets(
  kit: Kit,
  initialColor: BuildingColor,
  onProgress: (pct: number) => void,
): Promise<{ cache: Map<string, GLTF>; texture: THREE.Texture }> {
  const manager = makeLoadingManager();
  const gltfLoader = makeGltfLoader(manager);

  const sharedTexture = await loadKitTexture(kit, 'default');

  const entries =
    kit === 'space'
      ? SPACE_ASSET_CATALOG
      : [...getAlwaysLoadedAssets(), ...getAssetsByColor(initialColor)];
  const total = entries.length;
  let loaded = 0;

  const cache = await loadEntries(entries, gltfLoader, sharedTexture, () => {
    loaded++;
    onProgress((loaded / total) * 100);
  });

  return { cache, texture: sharedTexture };
}

/** Lazy load: only the GLTFs for one color of building variants.
 *  Returned cache must be merged into the existing one. */
export async function loadColorAssets(
  color: BuildingColor,
  sharedTexture: THREE.Texture,
): Promise<Map<string, GLTF>> {
  const manager = makeLoadingManager();
  const gltfLoader = makeGltfLoader(manager);
  return loadEntries(getAssetsByColor(color), gltfLoader, sharedTexture);
}
