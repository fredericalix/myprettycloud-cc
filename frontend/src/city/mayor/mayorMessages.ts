import type { MayorMood } from '../stores/useMayorStore';
import { useMapStore } from '../stores/useMapStore';

/** A ready-to-enqueue announcement payload (no id/ts yet). */
export interface MayorPayload {
  mood: MayorMood;
  title: string;
  detail: string;
}

/** Fallback when we can't resolve a friendly name for a resource. */
const UNKNOWN = 'an unnamed holding';
/** Space flavour calls the same fallback a "module". */
const UNKNOWN_SPACE = 'an unnamed module';

function appName(name: string | null | undefined): string {
  return name && name.trim() ? name : UNKNOWN;
}

function unitName(name: string | null | undefined): string {
  return name && name.trim() ? name : UNKNOWN_SPACE;
}

/** Which voice to speak in — keyed off the loaded map's kit (read at call time). */
function inSpace(): boolean {
  return useMapStore.getState().kit === 'space';
}

/** Pick the medieval or space variant of a payload depending on the active kit. */
function voiced(medieval: MayorPayload, space: MayorPayload): MayorPayload {
  return inSpace() ? space : medieval;
}

/**
 * Lifecycle announcements. The `title` carries the flavour — medieval-light for
 * the town, mission-control for the station; the `detail` stays plainly readable
 * (resource name + what happened) so the popup is useful even if you ignore the
 * role-play. All strings are English (single-locale app — see CLAUDE.md).
 */
export const mayorMessages = {
  deploySuccess: (name: string | null): MayorPayload =>
    voiced(
      {
        mood: 'happy',
        title: `Victory! The banners fly over ${appName(name)}.`,
        detail: `Deploy succeeded — ${appName(name)}`,
      },
      {
        mood: 'happy',
        title: `Module online — ${unitName(name)} is go.`,
        detail: `Deploy succeeded — ${unitName(name)}`,
      },
    ),

  deployFail: (name: string | null): MayorPayload =>
    voiced(
      {
        mood: 'alarmed',
        title: `Alas, my Lord — ${appName(name)} has fallen.`,
        detail: `Deployment failed — ${appName(name)}`,
      },
      {
        mood: 'alarmed',
        title: `Commander — ${unitName(name)} is down.`,
        detail: `Deployment failed — ${unitName(name)}`,
      },
    ),

  appCreated: (name: string | null): MayorPayload =>
    voiced(
      {
        mood: 'happy',
        title: `New ground is broken: ${appName(name)} rises.`,
        detail: `App created — ${appName(name)}`,
      },
      {
        mood: 'happy',
        title: `New module docked: ${unitName(name)} comes online.`,
        detail: `App created — ${unitName(name)}`,
      },
    ),

  appStopped: (name: string | null): MayorPayload =>
    voiced(
      {
        mood: 'neutral',
        title: `${appName(name)} has shuttered its gates.`,
        detail: `App stopped — ${appName(name)}`,
      },
      {
        mood: 'neutral',
        title: `${unitName(name)} has powered down.`,
        detail: `App stopped — ${unitName(name)}`,
      },
    ),

  appRemoved: (name: string | null): MayorPayload =>
    voiced(
      {
        mood: 'neutral',
        title: `${appName(name)} was razed from the map.`,
        detail: `App removed — ${appName(name)}`,
      },
      {
        mood: 'neutral',
        title: `${unitName(name)} was decommissioned.`,
        detail: `App removed — ${unitName(name)}`,
      },
    ),

  addonAdded: (provider: string | null): MayorPayload => {
    const what = provider && provider.trim() ? provider : 'service';
    return voiced(
      {
        mood: 'happy',
        title: `A new ${what} well now serves the realm.`,
        detail: `Add-on created — ${what}`,
      },
      {
        mood: 'happy',
        title: `A new ${what} system is wired into the station.`,
        detail: `Add-on created — ${what}`,
      },
    );
  },

  addonRemoved: (name: string | null): MayorPayload =>
    voiced(
      {
        mood: 'neutral',
        title: `The ${appName(name)} well was filled in.`,
        detail: `Add-on removed — ${appName(name)}`,
      },
      {
        mood: 'neutral',
        title: `The ${unitName(name)} system was taken offline.`,
        detail: `Add-on removed — ${unitName(name)}`,
      },
    ),

  addonUnhealthy: (name: string | null): MayorPayload =>
    voiced(
      {
        mood: 'alarmed',
        title: `The ${appName(name)} well runs foul.`,
        detail: `Add-on unhealthy — ${appName(name)}`,
      },
      {
        mood: 'alarmed',
        title: `The ${unitName(name)} system is failing.`,
        detail: `Add-on unhealthy — ${unitName(name)}`,
      },
    ),

  addonRecovered: (name: string | null): MayorPayload =>
    voiced(
      {
        mood: 'happy',
        title: `The ${appName(name)} well runs clear again.`,
        detail: `Add-on healthy — ${appName(name)}`,
      },
      {
        mood: 'happy',
        title: `The ${unitName(name)} system is back to nominal.`,
        detail: `Add-on healthy — ${unitName(name)}`,
      },
    ),
};

/**
 * Proactive tips — not tied to a WS frame. Kept curated and few so the mayor
 * advises rather than nags.
 */
export const mayorTipMessages = {
  welcome: (orgName: string): MayorPayload =>
    voiced(
      {
        mood: 'neutral',
        title: `Welcome to ${orgName || 'your realm'}, my Lord.`,
        detail: 'Click any building to inspect the app or add-on it stands for.',
      },
      {
        mood: 'neutral',
        title: `Welcome aboard ${orgName || 'your station'}, Commander.`,
        detail: 'Select any structure to inspect the app or add-on it stands for.',
      },
    ),

  viewMode: (): MayorPayload =>
    voiced(
      {
        mood: 'neutral',
        title: 'Survey your town from on high.',
        detail: 'Switch to View mode for a cinematic tour of the realm.',
      },
      {
        mood: 'neutral',
        title: 'Survey the station from orbit.',
        detail: 'Switch to View mode for a cinematic tour of the base.',
      },
    ),

  realtime: (): MayorPayload =>
    voiced(
      {
        mood: 'neutral',
        title: 'Hear of every deed at once.',
        detail: 'Use ⚡ Realtime setup to get sub-second updates from Clever Cloud.',
      },
      {
        mood: 'neutral',
        title: 'Get live telemetry as it happens.',
        detail: 'Use ⚡ Realtime setup to get sub-second updates from Clever Cloud.',
      },
    ),

  cityTrouble: (failedCount: number): MayorPayload =>
    voiced(
      {
        mood: 'alarmed',
        title: `Trouble in the realm.`,
        detail:
          failedCount === 1
            ? '1 app has fallen — check the red building.'
            : `${failedCount} apps have fallen — check the red buildings.`,
      },
      {
        mood: 'alarmed',
        title: `Sector alert.`,
        detail:
          failedCount === 1
            ? '1 module is down — check the red structure.'
            : `${failedCount} modules are down — check the red structures.`,
      },
    ),

  cityWell: (): MayorPayload =>
    voiced(
      {
        mood: 'happy',
        title: 'All is well across the realm.',
        detail: 'Every app stands green and healthy.',
      },
      {
        mood: 'happy',
        title: 'All systems nominal across the station.',
        detail: 'Every module reads green and healthy.',
      },
    ),

  /** Pinned while the scene loads. `progress` is updated in place each tick.
   *  No hard duration ("~10s") — the live count carries the progress. */
  cityLoading: (reported: number, total: number): MayorPayload & { progress: string } => {
    const v = voiced(
      {
        mood: 'neutral',
        title: 'The realm takes stock…',
        detail: "Gathering each holding's tidings.",
      },
      {
        mood: 'neutral',
        title: 'Station roll-call…',
        detail: 'Polling each module for telemetry.',
      },
    );
    return {
      ...v,
      progress: inSpace()
        ? `${reported} of ${total} modules have reported.`
        : `${reported} of ${total} holdings have reported.`,
    };
  },

  /** Organic all-clear once every holding has reported with its true colour. */
  realmTrue: (): MayorPayload =>
    voiced(
      {
        mood: 'happy',
        title: 'The realm stands true.',
        detail: 'Every holding reports in — statuses and live readings are current.',
      },
      {
        mood: 'happy',
        title: 'The station reads true.',
        detail: 'Every module reports in — statuses and live readings are current.',
      },
    ),

  /** Soft verdict when a few holdings are still silent at the safety timeout. */
  realmPartial: (): MayorPayload =>
    voiced(
      {
        mood: 'neutral',
        title: 'Most of the realm reports in.',
        detail: 'A few holdings are slow to answer; showing what we have.',
      },
      {
        mood: 'neutral',
        title: 'Most of the station reports in.',
        detail: 'A few modules are slow to answer; showing what we have.',
      },
    ),
};
