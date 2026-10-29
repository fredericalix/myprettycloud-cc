import { useMemo } from 'react';
import * as THREE from 'three';
import { useGrid } from '../../hooks/useGrid';
import { useMapStore } from '../../stores/useMapStore';
import { parseCellKey } from '../../utils/gridMath';

// Flat ring matching the cell outline: hexagonal (medieval) or square (space).
// `sides` polygon, vertices on the circumradius, rotated so a flat edge faces +X
// like the tiles do.
function createCellRingGeometry(sides: number, circumradius: number): THREE.BufferGeometry {
  const points: THREE.Vector3[] = [];
  const innerR = circumradius * 0.85;
  const outerR = circumradius;
  const offset = sides === 6 ? Math.PI / 6 : Math.PI / 4;

  for (let i = 0; i <= sides; i++) {
    const angle = ((Math.PI * 2) / sides) * i + offset;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    points.push(new THREE.Vector3(cos * innerR, 0, sin * innerR));
    points.push(new THREE.Vector3(cos * outerR, 0, sin * outerR));
  }

  const geometry = new THREE.BufferGeometry();
  const vertices: number[] = [];
  const ringLen = (sides + 1) * 2;

  for (let i = 0; i < sides; i++) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = (i * 2 + 2) % ringLen;
    const d = (i * 2 + 3) % ringLen;

    // Two triangles per side
    vertices.push(
      points[a]!.x, points[a]!.y, points[a]!.z,
      points[b]!.x, points[b]!.y, points[b]!.z,
      points[c]!.x, points[c]!.y, points[c]!.z,
    );
    vertices.push(
      points[b]!.x, points[b]!.y, points[b]!.z,
      points[d]!.x, points[d]!.y, points[d]!.z,
      points[c]!.x, points[c]!.y, points[c]!.z,
    );
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function SelectionIndicator() {
  const selectedCell = useMapStore((s) => s.selectedCell);
  const cells = useMapStore((s) => s.cells);
  const grid = useGrid();

  const sides = grid.rotationSteps === 4 ? 4 : 6;
  const geometry = useMemo(
    () => createCellRingGeometry(sides, sides === 6 ? 1.0 : grid.cellCircumradius),
    [sides, grid.cellCircumradius],
  );

  if (!selectedCell) return null;

  const cell = cells.get(selectedCell);
  if (!cell) return null;

  const { q, r } = parseCellKey(selectedCell);
  const { x, z } = grid.cellToWorld(q, r);
  const y = (cell.elevation ?? 0) + 0.02;

  return (
    <mesh geometry={geometry} position={[x, y, z]}>
      <meshBasicMaterial color={0x00aaff} transparent opacity={0.6} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}
