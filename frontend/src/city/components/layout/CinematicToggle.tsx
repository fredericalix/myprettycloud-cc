import { useCinematicStore } from '../../stores/useCinematicStore';
import { useUiModeStore } from '../../stores/useUiModeStore';

export function CinematicToggle() {
  const uiMode = useUiModeStore((s) => s.mode);
  const active = useCinematicStore((s) => s.active);
  const toggle = useCinematicStore((s) => s.toggle);

  if (uiMode !== 'view') return null;

  return (
    <button
      onClick={toggle}
      className="font-overtitle text-[10px] flex items-center gap-1.5 rounded px-2 py-1 transition"
      style={{
        background: active ? 'rgba(255,255,255,0.15)' : 'rgba(241,240,251,0.06)',
        color: 'var(--cc-white)',
      }}
      title={active ? 'Stop the cinematic orbit' : 'Orbit the camera around the city'}
    >
      <span>🎥</span>{active ? 'Stop' : 'Cinematic'}
    </button>
  );
}
