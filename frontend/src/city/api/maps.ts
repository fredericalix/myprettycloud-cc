import { api } from './client';
import type { HexCell } from '../types/map';

/** Per-scene ambiance toggles persisted with the map. */
export interface SceneSettings {
  windEnabled?: boolean;
  waterEnabled?: boolean;
  dayNightEnabled?: boolean;
  particlesEnabled?: boolean;
  cloudsEnabled?: boolean;
  /** Metric-driven vehicles travelling between buildings. */
  trafficEnabled?: boolean;
  /** RAM crates + disk depot props around bound buildings. */
  storagePropsEnabled?: boolean;
  /** Season texture theme: 'default' | 'Summer' | 'Fall' | 'Winter'. Medieval only. */
  theme?: string;
  /** Visual kit: 'medieval' (hex grid, default for pre-kit maps) | 'space'.
   *  Chosen once via the kit prompt; absent only on never-seeded maps. */
  kit?: string;
}

export interface MapResponse {
  name: string;
  cells: HexCell[];
  settings: SceneSettings;
  version: number;
}

export interface MapPayload {
  name: string;
  cells: HexCell[];
  settings: SceneSettings;
}

export function getMap(orgId: string): Promise<MapResponse> {
  return api<MapResponse>(`/api/orgs/${encodeURIComponent(orgId)}/map`);
}

export function saveMap(orgId: string, payload: MapPayload): Promise<MapResponse> {
  return api<MapResponse>(`/api/orgs/${encodeURIComponent(orgId)}/map`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}
