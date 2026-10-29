import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useMayorStore } from '../../stores/useMayorStore';
import { useMapStore } from '../../stores/useMapStore';
import { MayorPortrait, moodAccent } from './MayorPortrait';

function timeLabel(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

/**
 * The mayor's chronicle: a scrollable log of past announcements plus the mute
 * toggle. Portalled to `document.body` (like WebhookSetupModal) so the fixed
 * layer escapes the topbar's backdrop-filter containing block. Rendered only
 * when open.
 */
export function MayorHistory() {
  const open = useMayorStore((s) => s.historyOpen);
  const history = useMayorStore((s) => s.history);
  const enabled = useMayorStore((s) => s.enabled);
  const setHistoryOpen = useMayorStore((s) => s.setHistoryOpen);
  const clearHistory = useMayorStore((s) => s.clearHistory);
  const setEnabled = useMayorStore((s) => s.setEnabled);
  const isSpace = useMapStore((s) => s.kit === 'space');

  useEffect(() => {
    if (!open) return;
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setHistoryOpen(false);
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [open, setHistoryOpen]);

  if (!open) return null;

  const node = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: 'rgba(12,10,28,0.72)' }}
      onClick={() => setHistoryOpen(false)}
    >
      <div
        className="cc-panel rounded-2xl p-5 max-w-[460px] w-full max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="font-overtitle text-[10px]" style={{ color: 'var(--cc-orange)' }}>
              {isSpace ? 'Comms officer' : 'Town crier'}
            </div>
            <h2 className="font-semibold text-lg">
              {isSpace ? 'The Commander’s log' : 'The Mayor’s chronicle'}
            </h2>
          </div>
          <button
            className="cc-muted hover:text-white"
            onClick={() => setHistoryOpen(false)}
            title="Close"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <label
          className="flex items-center gap-2 text-[13px] mb-3 cursor-pointer select-none"
          title={
            isSpace
              ? 'Silence the commander — no more announcements will appear'
              : 'Silence the mayor — no more announcements will appear'
          }
        >
          <input
            type="checkbox"
            checked={!enabled}
            onChange={(e) => setEnabled(!e.target.checked)}
          />
          {isSpace ? 'Mute the commander' : 'Mute the mayor'}
        </label>

        <div className="flex-1 overflow-y-auto -mr-2 pr-2">
          {history.length === 0 ? (
            <div className="cc-muted text-sm py-6 text-center">
              No announcements yet.
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {history.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center gap-3 rounded-lg p-2"
                  style={{
                    background: 'rgba(241,240,251,0.04)',
                    borderLeft: `3px solid ${moodAccent(m.mood)}`,
                  }}
                >
                  <MayorPortrait mood={m.mood} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="font-brand text-[13px] leading-tight text-white">
                      {m.title}
                    </div>
                    <div className="cc-muted text-[11px] truncate" title={m.detail}>
                      {m.detail}
                    </div>
                  </div>
                  <span className="cc-muted text-[10px] shrink-0">{timeLabel(m.ts)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {history.length > 0 && (
          <button
            onClick={() => clearHistory()}
            className="mt-3 self-end font-overtitle text-[10px] rounded px-2 py-1 transition"
            style={{ background: 'rgba(241,240,251,0.06)', color: 'var(--cc-white)' }}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
