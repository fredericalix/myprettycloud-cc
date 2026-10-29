import { create } from 'zustand';

interface MusicState {
  enabled: boolean;
  currentTrack: string | null;
  /** Every track of the current playlist failed to load (the mp3s are not
   *  shipped with the open-source build) — the toggle hides itself. */
  unavailable: boolean;
  setEnabled: (v: boolean) => void;
  setCurrentTrack: (t: string | null) => void;
  setUnavailable: (v: boolean) => void;
}

const STORAGE_KEY = 'mycctown.music.enabled';

function readStoredEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export const useMusicStore = create<MusicState>((set) => ({
  enabled: readStoredEnabled(),
  currentTrack: null,
  unavailable: false,
  setEnabled: (enabled) => {
    try {
      localStorage.setItem(STORAGE_KEY, String(enabled));
    } catch {
      // ignore
    }
    set({ enabled });
  },
  setCurrentTrack: (currentTrack) => set({ currentTrack }),
  setUnavailable: (unavailable) => set({ unavailable }),
}));
