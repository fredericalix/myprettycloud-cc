// Single CDN base for static media (3D assets, music, mayor portraits). In
// production this points at the Cellar bucket; when unset (local dev) URLs fall
// back to same-origin paths served from /public. NEXT_PUBLIC_* is inlined at
// build time by Next, so this is a constant in the client bundle.
export const CDN_BASE = (process.env.NEXT_PUBLIC_CDN_BASE_URL ?? "").replace(/\/$/, "");

/** Resolve a media path (e.g. "music", "mayor/x.png", "assets/...") to the CDN
 *  when configured, else to a same-origin absolute path. */
export function cdnUrl(path: string): string {
  const p = path.replace(/^\//, "");
  return CDN_BASE ? `${CDN_BASE}/${p}` : `/${p}`;
}
