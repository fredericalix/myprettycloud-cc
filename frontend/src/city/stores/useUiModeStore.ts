import { create } from 'zustand';

export type UiMode = 'builder' | 'view';

interface UiModeState {
  mode: UiMode;
  setMode: (m: UiMode) => void;
}

const STORAGE_KEY = 'mycctown.uiMode';

function readStoredMode(): UiMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'view' || raw === 'builder') return raw;
  } catch {
    // ignore
  }
  return 'builder';
}

/** UI mode switch between `builder` (docked inspector + mapping panel) and
 *  `view` (floating inspector anchored to the clicked building in 3D). */
export const useUiModeStore = create<UiModeState>((set) => ({
  mode: readStoredMode(),
  setMode: (mode) => {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // ignore
    }
    set({ mode });
  },
}));
