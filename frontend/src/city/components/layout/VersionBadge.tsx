import { APP_VERSION, RELEASES_URL } from '../../data/version';
import { useVersionStore } from '../../stores/useVersionStore';

/**
 * Discreet white version badge in the bottom-right corner of the scene. Links
 * to the public changelog. Hidden via the top-bar toggle (useVersionStore);
 * the container ignores pointer events so it never blocks the canvas — only the
 * link itself is clickable.
 */
export function VersionBadge() {
  const showBadge = useVersionStore((s) => s.showBadge);
  if (!showBadge) return null;

  return (
    <div
      className="absolute z-10"
      style={{ right: 14, bottom: 12, pointerEvents: 'none' }}
    >
      <a
        href={RELEASES_URL}
        target="_blank"
        rel="noopener noreferrer"
        title="What's new — open the release notes"
        style={{
          pointerEvents: 'auto',
          fontSize: '10px',
          letterSpacing: '0.04em',
          fontVariantNumeric: 'tabular-nums',
          color: 'rgba(255,255,255,0.6)',
          textDecoration: 'none',
          textShadow: '0 1px 3px rgba(0,0,0,0.55)',
          transition: 'color 120ms ease',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.95)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.6)')}
      >
        v{APP_VERSION}
      </a>
    </div>
  );
}
