import { useState } from 'react';
import { useMapStore } from '../../stores/useMapStore';
import { useAnimationStore } from '../../stores/useAnimationStore';
import { useAssetStore } from '../../stores/useAssetStore';
import { useUiModeStore } from '../../stores/useUiModeStore';
import { DEFAULT_KIT } from '../../types/kit';
import { THEMES } from '../../utils/assetLoader';

/**
 * Minimal side rail. Top stack: primary mode toggle (builder / view).
 * Middle stack: live scene animation toggles (wind, water, day-night,
 * particles, clouds). Bottom: clear-city escape hatch + autosave dot.
 *
 * The mode toggle used to live in the topbar but visually competed with
 * the user menu there — moving it here makes it the first control the eye
 * lands on when looking at the tool rail.
 */
export function LeftSidebar() {
  const clearMap = useMapStore((s) => s.clearMap);
  const resetMap = useMapStore((s) => s.resetMap);
  const saveStatus = useMapStore((s) => s.saveStatus);
  const kit = useMapStore((s) => s.kit) ?? DEFAULT_KIT;
  const uiMode = useUiModeStore((s) => s.mode);
  const setMode = useUiModeStore((s) => s.setMode);
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <div className="absolute left-0 top-0 bottom-0 z-20 flex pointer-events-none">
      <div
        className="cc-panel flex flex-col items-center py-3 px-2 gap-2 pointer-events-auto w-[74px]"
        style={{
          borderLeft: 'none',
          borderTopRightRadius: 14,
          borderBottomRightRadius: 14,
        }}
      >
        <ModeButton
          icon="✎"
          label="Builder"
          active={uiMode === 'builder'}
          onClick={() => setMode('builder')}
        />
        <ModeButton
          icon="👁"
          label="View"
          active={uiMode === 'view'}
          onClick={() => setMode('view')}
        />

        <Separator />

        <AnimToggles kit={kit} />

        {/* Seasons re-skin the medieval atlas; the space kit has no seasonal
            variants, so the picker disappears there. */}
        {kit === 'medieval' && (
          <>
            <Separator />
            <SeasonPicker />
          </>
        )}

        <Separator />

        <button
          onClick={clearMap}
          title="Clear city (resets all placements, keeps the style)"
          className="w-full rounded-lg py-2 flex flex-col items-center gap-0.5 transition"
          style={{ color: 'var(--cc-red-1)' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(230,63,72,0.1)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <span className="text-xl leading-none">🧹</span>
          <span className="text-[11px] leading-tight font-medium">Clear</span>
        </button>

        <button
          onClick={() => setConfirmReset(true)}
          title="Reset the map and pick a new style (medieval / space). All placements are lost."
          className="w-full rounded-lg py-2 flex flex-col items-center gap-0.5 transition"
          style={{ color: 'var(--cc-red-1)' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(230,63,72,0.1)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <span className="text-xl leading-none">🎨</span>
          <span className="text-[11px] leading-tight font-medium">Style</span>
        </button>

        <div className="flex-1" />

        <SaveDot status={saveStatus} />
      </div>

      {confirmReset && (
        <ResetConfirm
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => {
            setConfirmReset(false);
            void resetMap();
          }}
        />
      )}
    </div>
  );
}

/** Confirmation for the style-reset escape hatch — resetMap wipes every
 *  placement and brings back the kit prompt. */
function ResetConfirm({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center pointer-events-auto"
      style={{ background: 'rgba(10,10,20,0.6)' }}
      onClick={onCancel}
    >
      <div
        className="cc-panel rounded-2xl p-5 w-[340px] text-[13px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-overtitle text-[10px]" style={{ color: 'var(--cc-orange)' }}>
          Reset map
        </div>
        <div className="mt-1 text-sm font-semibold">Change the city&apos;s style?</div>
        <p className="cc-muted mt-2 leading-relaxed">
          This empties the map — every tile, building and resource placement is
          lost — and lets you pick Medieval or Space again. Your Clever Cloud
          resources are untouched and can be re-placed afterwards.
        </p>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            className="text-xs cc-muted hover:text-white px-2 py-1"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="rounded-lg px-3 py-1.5 text-xs font-semibold"
            style={{ background: 'rgba(230,63,72,0.9)', color: 'var(--cc-white)' }}
            onClick={onConfirm}
          >
            Reset & choose style
          </button>
        </div>
      </div>
    </div>
  );
}

function ModeButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className="w-full rounded-lg py-2 flex flex-col items-center gap-0.5 transition"
      style={{
        background: active ? 'rgba(165,16,80,0.35)' : 'transparent',
        color: active ? 'var(--cc-white)' : 'var(--cc-gray-soft)',
        fontWeight: active ? 600 : 400,
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'rgba(241,240,251,0.06)';
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent';
      }}
    >
      <span className="text-xl leading-none">{icon}</span>
      <span className="text-[11px] leading-tight">{label}</span>
    </button>
  );
}

function Separator() {
  return <div className="w-10 h-px my-1" style={{ background: 'rgba(241,240,251,0.12)' }} />;
}

function SaveDot({ status }: { status: 'idle' | 'saving' | 'saved' | 'error' }) {
  if (status === 'idle') return null;
  const map = {
    saving: { label: '…', color: 'var(--cc-gray)' },
    saved: { label: '✓', color: 'var(--cc-green)' },
    error: { label: '⚠', color: 'var(--cc-red-1)' },
  } as const;
  const { label, color } = map[status];
  return (
    <span className="text-sm" style={{ color }} title={`Autosave: ${status}`}>
      {label}
    </span>
  );
}

const SEASON_ICON: Record<string, string> = {
  default: '🌿',
  Summer: '☀️',
  Fall: '🍂',
  Winter: '❄️',
};

/** Season texture theme — re-skins the whole scene and persists per org. */
function SeasonPicker() {
  const theme = useAssetStore((s) => s.theme);
  const setTheme = useAssetStore((s) => s.setTheme);
  const scheduleSave = useMapStore((s) => s.scheduleSave);

  return (
    <div className="flex flex-col gap-1 items-center">
      {THEMES.map((t) => (
        <button
          key={t}
          className="w-11 h-11 flex items-center justify-center rounded-lg text-lg transition"
          title={`Season: ${t}`}
          onClick={() => {
            void setTheme(t);
            scheduleSave();
          }}
          style={{
            background: theme === t ? 'rgba(165,16,80,0.35)' : 'transparent',
            opacity: theme === t ? 1 : 0.5,
          }}
        >
          {SEASON_ICON[t] ?? '🎨'}
        </button>
      ))}
    </div>
  );
}

function AnimToggles({ kit }: { kit: string }) {
  const store = useAnimationStore();
  // No weather on an airless world: clouds and water are medieval-only.
  const toggles = [
    { key: 'windEnabled' as const, icon: '💨', title: 'Wind' },
    ...(kit === 'medieval' ? [{ key: 'waterEnabled' as const, icon: '🌊', title: 'Water' }] : []),
    { key: 'dayNightEnabled' as const, icon: '🌅', title: 'Day / night cycle' },
    { key: 'particlesEnabled' as const, icon: '✨', title: 'Particles' },
    ...(kit === 'medieval' ? [{ key: 'cloudsEnabled' as const, icon: '☁️', title: 'Clouds' }] : []),
    { key: 'trafficEnabled' as const, icon: kit === 'space' ? '🚀' : '🐴', title: 'Traffic' },
    { key: 'storagePropsEnabled' as const, icon: '📦', title: 'RAM / disk props' },
  ];

  return (
    <div className="flex flex-col gap-1 items-center">
      {toggles.map(({ key, icon, title }) => (
        <button
          key={key}
          className="w-11 h-11 flex items-center justify-center rounded-lg text-lg transition"
          onClick={() => store.toggle(key)}
          title={title + (store[key] ? ' (on)' : ' (off)')}
          style={{
            background: store[key] ? 'rgba(17,190,169,0.15)' : 'transparent',
            opacity: store[key] ? 1 : 0.4,
          }}
        >
          {icon}
        </button>
      ))}
    </div>
  );
}
