import { useMapStore } from '../stores/useMapStore';
import { DEFAULT_KIT } from '../types/kit';
import { gridFor, type GridAdapter } from '../utils/gridMath';

/** The current map's grid geometry. Falls back to the medieval hex grid while
 *  the kit is still unknown (map loading / kit prompt) — nothing is rendered
 *  in that window anyway. */
export function useGrid(): GridAdapter {
  const kit = useMapStore((s) => s.kit);
  return gridFor(kit ?? DEFAULT_KIT);
}
