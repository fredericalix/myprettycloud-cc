// The changelog — the single source of truth for the /releases page. Newest
// first. The frontend's APP_VERSION (frontend/src/city/data/version.ts) is
// bumped to match the top entry's version at release time.

export interface Release {
  /** Semver, without the leading "v". */
  version: string;
  /** ISO date (YYYY-MM-DD) the release shipped. */
  date: string;
  /** One-line headline for the release. */
  title: string;
  /** What changed, as short user-facing bullet points. */
  changes: string[];
}

export const releases: Release[] = [
  {
    version: "0.5.0",
    date: "2026-06-20",
    title: "Auto-place that reuses your city instead of sprawling past it",
    changes: [
      "Auto-place and Place now fill the open ground you already have before anything else — buildings no longer land detached out beyond the edge of your city while there's still room inside.",
      "Only when the city genuinely runs out of buildable ground does the map grow, and the new ground is added right at the edge so it stays contiguous with your layout.",
      "Auto-placing several resources at once now fills tiles compactly without leaving gaps, and placing a single resource lands it on the nearest free tile.",
      "As before, placement never builds over roads, rivers, coasts, or your decorations.",
    ],
  },
  {
    version: "0.4.0",
    date: "2026-06-12",
    title: "Release notes, a space starter, and a smarter bustle",
    changes: [
      "Added these release notes and a discreet version badge in the corner of the city — toggle it from the top bar.",
      "New space maps now open on a hand-built “Starter — Space outpost”: mesas, a quarry and drill, a tunnel spine, landing pads, greenhouses and a solar field.",
      "The harbour now has a proper sailed ship instead of the little rowing boat.",
      "Carts and shuttles now always travel building-to-building — no more vehicles appearing or vanishing in the middle of nowhere — and are scaled to sit believably next to the buildings.",
      "Bridges placed on a river crossing keep the road usable instead of cutting it.",
    ],
  },
  {
    version: "0.3.0",
    date: "2026-06-11",
    title: "Every city starts as a place, not a blank grid",
    changes: [
      "Fresh and cleared medieval maps now open on a hand-composed “Starter — Medieval realm”: northern mountains, a river bridged by the main road, a sea coast, forests and farms.",
      "Auto-placed buildings settle on the village plaza and never build over roads, rivers, coasts or scenery.",
      "Both starter scenes are available any time from the Templates panel.",
    ],
  },
  {
    version: "0.2.0",
    date: "2026-06-11",
    title: "A real website, docs and tutorial",
    changes: [
      "Launched this site: a landing page, full documentation, and a step-by-step tutorial.",
      "The in-app Docs button now opens the documentation here.",
      "Added Thanks and Terms pages — and credited KayKit by Kay Lousberg for the 3D world.",
    ],
  },
];
