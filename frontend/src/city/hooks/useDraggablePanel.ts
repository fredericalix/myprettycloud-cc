import { useCallback, useEffect, useRef, useState } from 'react';

/** Margin kept visible so a panel dropped near an edge can still be grabbed back. */
const EDGE_MARGIN = 40;

export interface PanelPos {
  x: number;
  y: number;
}

function readStoredPos(key: string, fallback: PanelPos): PanelPos {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PanelPos>;
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
      return { x: parsed.x, y: parsed.y };
    }
  } catch {
    // ignore
  }
  return fallback;
}

/**
 * Pointer-capture drag state for a floating panel. Returns a position and
 * three handlers to spread on the element serving as drag handle. Position is
 * persisted to localStorage under `storageKey` on release (not on each move,
 * to avoid spamming the API).
 *
 * Elements inside the handle tagged with `data-no-drag` will not start a drag
 * — useful for a close button sitting in the header.
 */
export function useDraggablePanel(
  storageKey: string,
  defaultPos: PanelPos,
  panelWidth: number,
) {
  const [pos, setPos] = useState<PanelPos>(() => readStoredPos(storageKey, defaultPos));
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  // `dragging` must be reactive state: deriving it from `dragRef` during render
  // (a ref mutation doesn't re-render) left the grabbing cursor stale until an
  // unrelated render happened to run.
  const [dragging, setDragging] = useState(false);

  const clamp = useCallback(
    (x: number, y: number): PanelPos => {
      const maxX = Math.max(EDGE_MARGIN, window.innerWidth - EDGE_MARGIN);
      const maxY = Math.max(EDGE_MARGIN, window.innerHeight - EDGE_MARGIN);
      return {
        x: Math.min(maxX, Math.max(-(panelWidth - EDGE_MARGIN), x)),
        y: Math.min(maxY, Math.max(0, y)),
      };
    },
    [panelWidth],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if ((e.target as HTMLElement).closest('[data-no-drag]')) return;
      dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
      setDragging(true);
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    },
    [pos],
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const d = dragRef.current;
      if (!d) return;
      setPos(clamp(e.clientX - d.dx, e.clientY - d.dy));
    },
    [clamp],
  );
  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!dragRef.current) return;
      dragRef.current = null;
      setDragging(false);
      (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
      try {
        localStorage.setItem(storageKey, JSON.stringify(pos));
      } catch {
        // ignore
      }
    },
    [pos, storageKey],
  );

  // Re-clamp when the window shrinks below the panel.
  useEffect(() => {
    const onResize = () => setPos((p) => clamp(p.x, p.y));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clamp]);

  return {
    pos,
    dragging,
    dragProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
  };
}
