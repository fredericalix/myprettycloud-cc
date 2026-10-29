/** Visual kit of a map: which asset pack (and grid) the city is built from.
 *  Chosen once per map (onboarding prompt on first open), persisted in
 *  `maps.settings.kit`. Medieval = hex grid + per-color building variants;
 *  space = square grid, status carried by the badge sphere + flame particles. */
export type Kit = 'medieval' | 'space';

export const KITS = ['medieval', 'space'] as const;

/** Back-compat: maps saved before the kit axis existed are medieval. */
export const DEFAULT_KIT: Kit = 'medieval';
