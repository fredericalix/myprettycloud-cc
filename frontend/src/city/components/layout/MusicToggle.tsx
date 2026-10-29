import { useMusicStore } from '../../stores/useMusicStore';

export function MusicToggle() {
  const enabled = useMusicStore((s) => s.enabled);
  const currentTrack = useMusicStore((s) => s.currentTrack);
  const setEnabled = useMusicStore((s) => s.setEnabled);
  const unavailable = useMusicStore((s) => s.unavailable);
  if (unavailable) return null;

  const trackLabel = currentTrack?.replace(/\.mp3$/i, '') ?? null;
  const title = enabled
    ? `Ambient music on${trackLabel ? ` — ${trackLabel}` : ''}`
    : 'Play ambient music';

  return (
    <button
      onClick={() => setEnabled(!enabled)}
      className="font-overtitle text-[10px] flex items-center gap-1.5 rounded px-2 py-1 transition"
      style={{
        background: 'rgba(241,240,251,0.06)',
        color: 'var(--cc-white)',
      }}
      title={title}
    >
      <span>{enabled ? '🔊' : '🔇'}</span>Music
    </button>
  );
}
