import { create } from 'zustand';

interface CinematicState {
  active: boolean;
  start: () => void;
  stop: () => void;
  toggle: () => void;
}

/** Runtime-only flag for the View-mode cinematic camera orbit. Driven by the
 *  TopBar button (CinematicToggle) and consumed by useCinematicCamera. Not
 *  persisted — the orbit always starts off on a fresh page load. */
export const useCinematicStore = create<CinematicState>((set, get) => ({
  active: false,
  start: () => set({ active: true }),
  stop: () => set({ active: false }),
  toggle: () => set({ active: !get().active }),
}));
