import { api } from './client';
import type { HexCell } from '../types/map';

export type TemplateVisibility = 'private' | 'public';

/** List-row (no cells) returned by the list endpoints. */
export interface TemplateListItem {
  id: string;
  owner_id: string;
  name: string;
  visibility: TemplateVisibility;
  owner_name: string | null;
  created_at: string;
}

/** Full template (with cells) returned by get/create. */
export interface TemplateFull extends TemplateListItem {
  cells_json: HexCell[];
}

export function listMyTemplates(): Promise<TemplateListItem[]> {
  return api<TemplateListItem[]>('/api/templates');
}

export function listPublicTemplates(): Promise<TemplateListItem[]> {
  return api<TemplateListItem[]>('/api/templates/public');
}

export function getTemplate(id: string): Promise<TemplateFull> {
  return api<TemplateFull>(`/api/templates/${encodeURIComponent(id)}`);
}

export function createTemplate(
  name: string,
  visibility: TemplateVisibility,
  cells: HexCell[],
): Promise<TemplateFull> {
  return api<TemplateFull>('/api/templates', {
    method: 'POST',
    body: JSON.stringify({ name, visibility, cells }),
  });
}

export function updateTemplate(
  id: string,
  patch: { name?: string; visibility?: TemplateVisibility },
): Promise<TemplateFull> {
  return api<TemplateFull>(`/api/templates/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteTemplate(id: string): Promise<void> {
  return api<void>(`/api/templates/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/**
 * Strip a map down to a shareable template: drop all CC resource bindings
 * (appId/addonId/monitorId), and drop the building on cells that were bound
 * (their building represented the resource). Unbound decorative buildings,
 * tiles and decorations are kept.
 */
export function toTemplateCells(cells: HexCell[]): HexCell[] {
  return cells.map((c) => {
    const bound = Boolean(c.appId || c.addonId || c.monitorId);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { appId, addonId, monitorId, building, buildingRotation, ...rest } = c;
    return bound ? rest : { ...rest, building, buildingRotation };
  });
}
