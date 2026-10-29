import { create } from 'zustand';
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { type BuildingColor } from '../data/assetCatalog';
import type { Kit } from '../types/kit';
import { loadAtlas, loadColorAssets } from '../utils/assetLoader';
import { debug } from '../utils/debug';

/** Loaded season atlases, keyed by theme (module-level, non-reactive cache). */
const atlasCache = new Map<string, THREE.Texture>();
async function getAtlas(theme: string): Promise<THREE.Texture> {
  const cached = atlasCache.get(theme);
  if (cached) return cached;
  const tex = await loadAtlas(theme);
  atlasCache.set(theme, tex);
  return tex;
}

/** Point every cached model's material at `tex` — re-skins the whole city
 *  (clones share materials by reference). */
function applyAtlasToCache(cache: Map<string, GLTF>, tex: THREE.Texture) {
  for (const gltf of cache.values()) {
    gltf.scene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material;
      const mats = Array.isArray(mat) ? mat : [mat];
      for (const m of mats) {
        const sm = m as THREE.MeshStandardMaterial;
        sm.map = tex;
        sm.needsUpdate = true;
      }
    });
  }
}

interface AssetState {
  loadingProgress: number;
  isLoaded: boolean;
  /** Which kit the current cache holds. Switching org to a map of another kit
   *  resets the cache and reloads (see useAssetLoader). */
  loadedKit: Kit | null;
  sharedTexture: THREE.Texture | null;
  cache: Map<string, GLTF>;
  /** Building-color subcategories already in `cache` (lazy-loaded variants). */
  loadedColors: Set<BuildingColor>;
  /** Building-color subcategories currently being fetched. */
  loadingColors: Set<BuildingColor>;

  setProgress: (pct: number) => void;
  /** Drop the previous kit's cache and show the loading screen again while the
   *  new kit's pack is fetched (org switch across kits). */
  beginKitLoad: () => void;
  setLoaded: (
    kit: Kit,
    texture: THREE.Texture,
    cache: Map<string, GLTF>,
    initialColor: BuildingColor,
  ) => void;
  cloneModel: (assetId: string) => THREE.Group | null;
  hasModel: (assetId: string) => boolean;
  /** Trigger lazy load of one building color variant if not already cached/loading. */
  ensureColorLoaded: (color: BuildingColor) => void;
  /** Current season theme; swaps the shared atlas across all cached models. */
  theme: string;
  setTheme: (theme: string) => Promise<void>;
}

export const useAssetStore = create<AssetState>((set, get) => ({
  loadingProgress: 0,
  isLoaded: false,
  loadedKit: null,
  sharedTexture: null,
  cache: new Map(),
  loadedColors: new Set(),
  loadingColors: new Set(),
  theme: 'default',

  setProgress: (pct) => set({ loadingProgress: pct }),

  beginKitLoad: () =>
    set({
      isLoaded: false,
      loadingProgress: 0,
      cache: new Map(),
      sharedTexture: null,
      loadedColors: new Set(),
      loadingColors: new Set(),
    }),

  setLoaded: (kit, texture, cache, initialColor) => {
    set({
      loadedKit: kit,
      sharedTexture: texture,
      cache,
      isLoaded: true,
      loadingProgress: 100,
      loadedColors: new Set([initialColor]),
    });
    // A scene may have requested a non-default season before assets finished
    // loading — apply it now that the cache exists (medieval only).
    if (kit === 'medieval' && get().theme !== 'default') void get().setTheme(get().theme);
  },

  setTheme: async (theme) => {
    set({ theme });
    if (!get().isLoaded) return; // applied later by setLoaded
    if (get().loadedKit !== 'medieval') return; // seasons are a medieval axis
    const tex = await getAtlas(theme);
    if (get().theme !== theme) return; // superseded by a newer pick
    applyAtlasToCache(get().cache, tex);
    set({ sharedTexture: tex });
  },

  cloneModel: (assetId) => {
    const gltf = get().cache.get(assetId);
    if (!gltf) return null;
    return gltf.scene.clone();
  },

  hasModel: (assetId) => get().cache.has(assetId),

  ensureColorLoaded: (color) => {
    const state = get();
    if (state.loadedKit !== 'medieval') return; // space has no color variants
    if (state.loadedColors.has(color) || state.loadingColors.has(color)) return;
    if (!state.sharedTexture) return;

    set({ loadingColors: new Set(state.loadingColors).add(color) });
    debug.log('asset:color', `lazy-load start "${color}"`);

    loadColorAssets(color, state.sharedTexture)
      .then((newAssets) => {
        const current = get();
        const newCache = new Map(current.cache);
        for (const [id, gltf] of newAssets) newCache.set(id, gltf);
        const newLoaded = new Set(current.loadedColors);
        newLoaded.add(color);
        const newLoading = new Set(current.loadingColors);
        newLoading.delete(color);
        set({ cache: newCache, loadedColors: newLoaded, loadingColors: newLoading });
        debug.log('asset:color', `lazy-load done "${color}" (+${newAssets.size})`);
      })
      .catch((e) => {
        debug.warn('asset:color', `lazy-load failed "${color}"`, e);
        const current = get();
        const newLoading = new Set(current.loadingColors);
        newLoading.delete(color);
        set({ loadingColors: newLoading });
      });
  },
}));
