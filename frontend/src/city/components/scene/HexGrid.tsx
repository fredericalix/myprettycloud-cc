import { useMemo } from 'react';
import { useMapStore } from '../../stores/useMapStore';
import { useAnimationContext } from './SceneCanvas';
import { HexTile } from './HexTile';

export function HexGrid() {
  const cells = useMapStore((s) => s.cells);
  const { registryRef } = useAnimationContext();

  const cellEntries = useMemo(
    () => Array.from(cells.entries()),
    [cells],
  );

  return (
    <group>
      {cellEntries.map(([key, cell]) => (
        <HexTile key={key} cell={cell} registryRef={registryRef} />
      ))}
    </group>
  );
}
