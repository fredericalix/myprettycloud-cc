import { useMayorStore } from '../../stores/useMayorStore';

/**
 * Topbar button that opens the mayor's chronicle (history + mute toggle).
 * Styled to match the other topbar pills (Music, Docs, Realtime setup).
 */
export function MayorToggle() {
  const toggleHistory = useMayorStore((s) => s.toggleHistory);
  const enabled = useMayorStore((s) => s.enabled);

  return (
    <button
      onClick={() => toggleHistory()}
      className="font-overtitle text-[10px] flex items-center gap-1.5 rounded px-2 py-1 transition"
      style={{
        background: 'rgba(241,240,251,0.06)',
        color: 'var(--cc-white)',
      }}
      title={enabled ? "Open the mayor's chronicle" : 'The mayor is muted — open the chronicle'}
    >
      <span>{enabled ? '🏛️' : '🔕'}</span>Mayor
    </button>
  );
}
