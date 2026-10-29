import { useEffect } from 'react';
import { useMayorStore } from '../../stores/useMayorStore';
import { useMapStore } from '../../stores/useMapStore';
import { MayorPortrait, moodAccent } from './MayorPortrait';

/** How long an announcement stays before auto-advancing. Bad news lingers. */
function dwellMs(mood: string): number {
  return mood === 'alarmed' ? 9_000 : 6_500;
}

/**
 * The mayor advisor popup. Sits bottom-left over the 3D scene (clear of the
 * 74px builder rail), shows one announcement at a time, auto-dismisses after a
 * mood-dependent dwell, then pulls the next queued announcement in.
 *
 * Mounted inside the scene's `<main>` (App.tsx) — never on the /docs route, so
 * it can't interfere with that page's scroll container.
 */
export function MayorPopup() {
  const pinned = useMayorStore((s) => s.pinned);
  const current = useMayorStore((s) => s.current);
  const next = useMayorStore((s) => s.next);
  const isSpace = useMapStore((s) => s.kit === 'space');

  // A pinned status notice (scene loading) always wins over the queue.
  const shown = pinned ?? current;

  // Auto-advance timer, reset whenever the displayed announcement changes.
  // Frozen while a notice is pinned — the pin must persist; the queue resumes
  // advancing once it clears.
  useEffect(() => {
    if (!shown || pinned) return;
    const t = window.setTimeout(() => next(), dwellMs(shown.mood));
    return () => window.clearTimeout(t);
  }, [shown, pinned, next]);

  if (!shown) return null;
  const accent = moodAccent(shown.mood);

  return (
    <div
      // `key` re-triggers the slide-in animation on each new announcement.
      // Stable across updatePinned (same id) so the progress line updates in
      // place without replaying the entrance.
      key={shown.id}
      className="mayor-pop cc-panel absolute z-30 rounded-2xl p-5 pr-12 flex items-center gap-5 pointer-events-auto"
      style={{
        left: 88,
        bottom: 24,
        width: 680,
        maxWidth: 'calc(100vw - 112px)',
        borderLeft: `5px solid ${accent}`,
      }}
      role="status"
      aria-live="polite"
    >
      <MayorPortrait mood={shown.mood} size={112} />

      <div className="min-w-0">
        <div className="font-overtitle text-[14px]" style={{ color: accent }}>
          {isSpace ? 'The Commander' : 'The Mayor'}
        </div>
        <div className="font-brand text-[28px] leading-tight text-white">
          {shown.title}
        </div>
        <div className="cc-muted text-[18px] mt-1 truncate" title={shown.detail}>
          {shown.detail}
        </div>
        {shown.progress && (
          // Live count for the pinned loading notice. aria-live="off" so a
          // screen reader hears the title once (via the container's polite
          // region), not on every 500ms tick.
          <div className="cc-muted text-[15px] mt-1 tabular-nums" aria-live="off">
            {shown.progress}
          </div>
        )}
      </div>

      {/* No dismiss control while pinned — the notice must persist, and a ✕
          wired to next() would silently corrupt the hidden queue. */}
      {!pinned && (
        <button
          onClick={() => next()}
          className="absolute top-3 right-3 cc-muted hover:text-white text-lg leading-none"
          title="Dismiss"
          aria-label="Dismiss"
        >
          ✕
        </button>
      )}
    </div>
  );
}
