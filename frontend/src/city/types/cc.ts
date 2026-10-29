export interface CcOrganisation {
  id: string;
  name: string;
  description?: string | null;
  avatar?: string | null;
  /** Live: at least one CC webhook on this org points at our receiver. */
  has_webhook?: boolean;
}

export interface CcApplication {
  id: string;
  name: string;
  description?: string | null;
  type?: string | null;
  state?: string | null;
  instance?: {
    type?: string | null;
    variant?: { name?: string | null; slug?: string | null } | null;
  } | null;
  zone?: string | null;
  last_deploy?: number | null;
}

/** Best-effort display slug for a CC app (top-level type first, then variant slug). */
export function appTypeSlug(app: CcApplication): string | null {
  return app.type ?? app.instance?.variant?.slug ?? app.instance?.type ?? null;
}

/** Friendly label for the app type (variant name > variant slug > raw type). */
export function appTypeLabel(app: CcApplication): string | null {
  return (
    app.instance?.variant?.name ??
    app.instance?.variant?.slug ??
    app.type ??
    app.instance?.type ??
    null
  );
}

export interface CcAddon {
  id: string;
  name: string;
  realId?: string | null;
  region?: string | null;
  provider?: { id?: string | null; name?: string | null } | null;
  creationDate?: number | null;
}
