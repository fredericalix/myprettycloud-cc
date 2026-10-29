import { useEffect, useRef } from 'react';
import { useAssetStore } from '../stores/useAssetStore';
import { useMapStore } from '../stores/useMapStore';
import { loadInitialAssets } from '../utils/assetLoader';
import { debug } from '../utils/debug';

// `green` matches `running` apps — the dominant case for a healthy org.
// Other colors (blue/red/yellow) are fetched on demand by HexTile when a
// building first needs them. (Medieval only — space has no color variants.)
const INITIAL_COLOR = 'green';

/** Loads the asset pack for the current map's kit. Waits until the kit is
 *  known (map loaded / kit chosen), and reloads from scratch when switching
 *  to an org whose map uses the other kit. */
export function useAssetLoader() {
  const kit = useMapStore((s) => s.kit);
  const loadedKit = useAssetStore((s) => s.loadedKit);
  const isLoaded = useAssetStore((s) => s.isLoaded);
  const setProgress = useAssetStore((s) => s.setProgress);
  const beginKitLoad = useAssetStore((s) => s.beginKitLoad);
  const setLoaded = useAssetStore((s) => s.setLoaded);
  const loadingKitRef = useRef<string | null>(null);

  useEffect(() => {
    if (!kit) return; // map still loading, or awaiting the kit prompt
    if ((isLoaded && loadedKit === kit) || loadingKitRef.current === kit) return;
    loadingKitRef.current = kit;
    if (isLoaded) beginKitLoad(); // kit switch: drop the old pack, show progress
    const startedAt = performance.now();
    debug.log('asset:initial', `start (kit=${kit}, color=${INITIAL_COLOR})`);

    loadInitialAssets(kit, INITIAL_COLOR, (pct) => {
      setProgress(pct);
    })
      .then(({ cache, texture }) => {
        setLoaded(kit, texture, cache, INITIAL_COLOR);
        debug.log(
          'asset:initial',
          `done in ${Math.round(performance.now() - startedAt)}ms (cache size=${cache.size})`,
        );
      })
      .finally(() => {
        loadingKitRef.current = null;
      });
  }, [kit, loadedKit, isLoaded, setProgress, beginKitLoad, setLoaded]);
}
