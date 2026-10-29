import { create } from 'zustand';

type ToggleKey =
  | 'windEnabled'
  | 'waterEnabled'
  | 'dayNightEnabled'
  | 'particlesEnabled'
  | 'cloudsEnabled'
  | 'trafficEnabled'
  | 'storagePropsEnabled';

interface AnimationState {
  windEnabled: boolean;
  waterEnabled: boolean;
  dayNightEnabled: boolean;
  particlesEnabled: boolean;
  cloudsEnabled: boolean;
  /** Metric-driven vehicles (carts / spacetrucks) travelling between buildings. */
  trafficEnabled: boolean;
  /** RAM crates + disk depot props accumulating around bound buildings. */
  storagePropsEnabled: boolean;

  toggle: (category: ToggleKey) => void;
  setAll: (enabled: boolean) => void;
}

export const useAnimationStore = create<AnimationState>((set) => ({
  windEnabled: true,
  waterEnabled: true,
  // Day/night cycle is off by default so the scene stays at noon — better
  // visibility for first-time users who want to inspect their city.
  dayNightEnabled: false,
  particlesEnabled: true,
  cloudsEnabled: true,
  trafficEnabled: true,
  storagePropsEnabled: true,

  toggle: (category) => set((state) => ({ [category]: !state[category] })),
  setAll: (enabled) =>
    set({
      windEnabled: enabled,
      waterEnabled: enabled,
      dayNightEnabled: enabled,
      particlesEnabled: enabled,
      cloudsEnabled: enabled,
      trafficEnabled: enabled,
      storagePropsEnabled: enabled,
    }),
}));
