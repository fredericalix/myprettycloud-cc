import { useVersionStore } from '../../stores/useVersionStore';

export function VersionToggle() {
  const showBadge = useVersionStore((s) => s.showBadge);
  const toggleBadge = useVersionStore((s) => s.toggleBadge);

  return (
    <button
      onClick={toggleBadge}
      className="font-overtitle text-[10px] flex items-center gap-1.5 rounded px-2 py-1 transition"
      style={{
        background: showBadge ? 'rgba(255,255,255,0.15)' : 'rgba(241,240,251,0.06)',
        color: 'var(--cc-white)',
      }}
      title={showBadge ? 'Hide the version badge' : 'Show the version badge'}
    >
      <span>🏷️</span>Version
    </button>
  );
}
