import { create } from 'zustand';

/** The mayor's mood drives which portrait + accent colour the popup shows. */
export type MayorMood = 'happy' | 'neutral' | 'alarmed';

export interface MayorMessage {
  id: string;
  mood: MayorMood;
  /** Short flavour headline (medieval-light). */
  title: string;
  /** Plain, readable technical line (app/addon name + what happened). */
  detail: string;
  ts: number;
  /** Live, frequently-updated line for the pinned loading notice (e.g.
   *  "3 of 7 holdings have reported."). Updated in place via `updatePinned`
   *  without touching id/title/detail, so the popup doesn't re-animate. */
  progress?: string;
}

/** How many past announcements the history panel retains. */
const HISTORY_MAX = 30;

interface MayorState {
  /** Announcements waiting to be shown, oldest first. */
  queue: MayorMessage[];
  /** The announcement currently displayed in the popup, or null. */
  current: MayorMessage | null;
  /** Past announcements, newest first. */
  history: MayorMessage[];
  /** Whether the history panel is open. */
  historyOpen: boolean;
  /** Master switch — when false, notify() is a no-op (the mayor is muted). */
  enabled: boolean;
  /** A persistent status notice (the scene-loading "stocktake") shown above the
   *  announcement queue and NEVER auto-dismissed. Survives muting — it's a
   *  system status indicator, not an advisory. */
  pinned: MayorMessage | null;

  /** Enqueue an announcement (shows immediately if nothing is on screen). */
  notify: (msg: Omit<MayorMessage, 'id' | 'ts'> & { ts?: number }) => void;
  /** Dismiss the current popup and pull the next queued announcement in. */
  next: () => void;
  /** Dismiss the current popup without pulling the next one. */
  dismiss: () => void;
  /** Pin a persistent notice (bypasses the mute switch). Returns its id so the
   *  caller can target updatePinned/clearPinned. Archived to history once. */
  setPinned: (msg: Omit<MayorMessage, 'id' | 'ts'> & { ts?: number }) => string;
  /** Update only the live progress line of the pinned notice (no history write,
   *  no re-animation). No-op if `id` isn't the current pinned message. */
  updatePinned: (id: string, progress: string) => void;
  /** Remove the pinned notice (the queue, if any, then shows through). */
  clearPinned: () => void;
  setHistoryOpen: (open: boolean) => void;
  toggleHistory: () => void;
  clearHistory: () => void;
  setEnabled: (v: boolean) => void;
}

const ENABLED_STORAGE_KEY = 'mycctown.mayor.enabled';

function readStoredEnabled(): boolean {
  try {
    // Default ON: only an explicit "false" mutes the mayor.
    return localStorage.getItem(ENABLED_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

/** Monotonic id counter — Date.now()/Math.random() avoided so ids stay
 *  deterministic and collision-free even within the same millisecond. */
let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `mayor-${idCounter}`;
}

function archive(history: MayorMessage[], msg: MayorMessage): MayorMessage[] {
  const next = [msg, ...history];
  if (next.length > HISTORY_MAX) next.length = HISTORY_MAX;
  return next;
}

export const useMayorStore = create<MayorState>((set) => ({
  queue: [],
  current: null,
  history: [],
  historyOpen: false,
  enabled: readStoredEnabled(),
  pinned: null,

  notify: (msg) =>
    set((state) => {
      if (!state.enabled) return {};
      const full: MayorMessage = {
        id: nextId(),
        mood: msg.mood,
        title: msg.title,
        detail: msg.detail,
        ts: msg.ts ?? Date.now(),
      };
      // Record in history immediately so muting later still keeps the trail.
      const history = archive(state.history, full);
      // Nothing on screen → show it now; otherwise queue behind the current one.
      if (state.current === null) {
        return { current: full, history };
      }
      return { queue: [...state.queue, full], history };
    }),

  next: () =>
    set((state) => {
      if (state.queue.length === 0) return { current: null };
      const [head, ...rest] = state.queue;
      return { current: head ?? null, queue: rest };
    }),

  dismiss: () => set({ current: null }),

  setPinned: (msg) => {
    const full: MayorMessage = {
      id: nextId(),
      mood: msg.mood,
      title: msg.title,
      detail: msg.detail,
      progress: msg.progress,
      ts: msg.ts ?? Date.now(),
    };
    // Bypasses `enabled` on purpose: the loading notice is a status indicator
    // the user asked to always see. Archived once here (updatePinned won't).
    set((state) => ({ pinned: full, history: archive(state.history, full) }));
    return full.id;
  },

  updatePinned: (id, progress) =>
    set((state) =>
      state.pinned && state.pinned.id === id
        ? { pinned: { ...state.pinned, progress } }
        : {},
    ),

  clearPinned: () => set({ pinned: null }),

  setHistoryOpen: (historyOpen) => set({ historyOpen }),
  toggleHistory: () => set((state) => ({ historyOpen: !state.historyOpen })),
  clearHistory: () => set({ history: [] }),

  setEnabled: (enabled) => {
    try {
      localStorage.setItem(ENABLED_STORAGE_KEY, String(enabled));
    } catch {
      // ignore
    }
    // Muting also clears anything pending so it doesn't surface later. The
    // `pinned` notice is intentionally left alone — it's a system status
    // indicator (scene loading), not an advisory, so it survives muting.
    set(enabled ? { enabled } : { enabled, queue: [], current: null });
  },
}));
