import { useEffect, useState } from 'react';

export function FullscreenToggle() {
  const [isFullscreen, setIsFullscreen] = useState(
    () => typeof document !== 'undefined' && document.fullscreenElement !== null,
  );

  useEffect(() => {
    const sync = () => setIsFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, []);

  const toggle = () => {
    try {
      if (!document.fullscreenElement) {
        const el = document.documentElement as HTMLElement & {
          webkitRequestFullscreen?: () => Promise<void> | void;
        };
        const req = el.requestFullscreen?.bind(el) ?? el.webkitRequestFullscreen?.bind(el);
        const result = req?.();
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch(() => {});
        }
      } else {
        const doc = document as Document & {
          webkitExitFullscreen?: () => Promise<void> | void;
        };
        const exit = doc.exitFullscreen?.bind(doc) ?? doc.webkitExitFullscreen?.bind(doc);
        const result = exit?.();
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch(() => {});
        }
      }
    } catch {
      // Fullscreen request rejected (policy, no user gesture, etc.) — silent.
    }
  };

  return (
    <button
      onClick={toggle}
      className="font-overtitle text-[10px] flex items-center gap-1.5 rounded px-2 py-1 transition"
      style={{
        background: 'rgba(241,240,251,0.06)',
        color: 'var(--cc-white)',
      }}
      title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
    >
      <span>⛶</span>{isFullscreen ? 'Exit' : 'Fullscreen'}
    </button>
  );
}
