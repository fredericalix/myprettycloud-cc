// Hybrid debug logger.
//
// Activation, evaluated once at module load:
//   - import.meta.env.DEV is true (Vite dev), OR
//   - import.meta.env.VITE_DEBUG_LOGS === 'true' (build with the flag), OR
//   - localStorage['mycctown.debug'] === '1', OR
//   - URL has ?debug=1 (the flag is then persisted to localStorage so a
//     subsequent reload without the param keeps logs on).
//
// debug.log/warn become no-ops when disabled. debug.error always logs and,
// when Sentry is initialised (VITE_SENTRY_DSN set), forwards to GlitchTip.

import * as Sentry from '@/city/utils/sentry-shim';

const STORAGE_KEY = 'mycctown.debug';

function isEnabled(): boolean {
  if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") return true;
  if (typeof window === 'undefined') return false;
  try {
    if (window.localStorage.getItem(STORAGE_KEY) === '1') return true;
    const params = new URLSearchParams(window.location.search);
    if (params.get('debug') === '1') {
      window.localStorage.setItem(STORAGE_KEY, '1');
      return true;
    }
  } catch {
    // localStorage may throw in some sandboxed contexts — treat as off.
  }
  return false;
}

const enabled = isEnabled();

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ');
}

function logToSentry(level: 'info' | 'warn' | 'error', scope: string, args: unknown[]) {
  // Sentry.logger is a no-op when enableLogs is false or Sentry isn't init.
  Sentry.logger?.[level]?.(`[${scope}] ${formatArgs(args)}`, { scope });
}

function reportError(scope: string, args: unknown[]) {
  const err = args.find((a) => a instanceof Error) as Error | undefined;
  if (err) {
    Sentry.captureException(err, { tags: { scope } });
  } else {
    Sentry.captureMessage(`[${scope}] ${formatArgs(args)}`, 'error');
  }
  logToSentry('error', scope, args);
}

export const debug = {
  enabled,
  log: (scope: string, ...args: unknown[]) => {
    if (enabled) console.debug(`[${scope}]`, ...args);
    logToSentry('info', scope, args);
  },
  warn: (scope: string, ...args: unknown[]) => {
    if (enabled) console.warn(`[${scope}]`, ...args);
    logToSentry('warn', scope, args);
  },
  error: (scope: string, ...args: unknown[]) => {
    console.error(`[${scope}]`, ...args);
    reportError(scope, args);
  },
};
