'use client';

import { useMapStore } from '../../stores/useMapStore';
import type { Kit } from '../../types/kit';

/** First-open choice for a fresh map: which visual kit the city uses.
 *  Replaces the builder until a style is picked — nothing is seeded or saved
 *  before that (and assets only load once the kit is known). */
export function KitPrompt() {
  const chooseKit = useMapStore((s) => s.chooseKit);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-8 p-8">
      <div className="text-center">
        <div className="font-overtitle text-xs" style={{ color: 'var(--cc-orange)' }}>
          New map
        </div>
        <h2 className="mt-2 text-xl font-semibold">Choose your city&apos;s style</h2>
        <p className="cc-muted mt-1 text-sm">
          Your infrastructure will be rendered in this world. You can start over later with
          “Reset map” in the builder sidebar.
        </p>
      </div>
      <div className="flex flex-wrap items-stretch justify-center gap-6">
        <KitCard
          kit="medieval"
          icon="🏰"
          title="Medieval"
          description="A hex-tile countryside of castles, mills and taverns. Status shows as building colours; four seasons to pick from."
          onPick={chooseKit}
        />
        <KitCard
          kit="space"
          icon="🚀"
          title="Space"
          description="An off-world colony of habitat modules, domes and landing pads on a regolith plain. Status glows as a beacon above each structure."
          onPick={chooseKit}
        />
      </div>
    </div>
  );
}

function KitCard({
  kit,
  icon,
  title,
  description,
  onPick,
}: {
  kit: Kit;
  icon: string;
  title: string;
  description: string;
  onPick: (kit: Kit) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(kit)}
      className="flex w-64 flex-col items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-6 text-center transition hover:border-white/30 hover:bg-white/10"
    >
      <span className="text-5xl" aria-hidden>
        {icon}
      </span>
      <span className="text-lg font-semibold">{title}</span>
      <span className="cc-muted text-xs leading-relaxed">{description}</span>
    </button>
  );
}
