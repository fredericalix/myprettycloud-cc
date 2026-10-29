import { create } from 'zustand';

interface VersionState {
  /** Whether the discreet version badge is shown over the scene. */
  showBadge: boolean;
  toggleBadge: () => void;
}

const STORAGE_KEY = 'myprettycloud.showVersionBadge';

/** Visible by default; only an explicit opt-out is remembered. */
function readStoredShowBadge(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

export const useVersionStore = create<VersionState>((set, get) => ({
  showBadge: readStoredShowBadge(),
  toggleBadge: () => {
    const showBadge = !get().showBadge;
    try {
      localStorage.setItem(STORAGE_KEY, String(showBadge));
    } catch {
      // ignore
    }
    set({ showBadge });
  },
}));
