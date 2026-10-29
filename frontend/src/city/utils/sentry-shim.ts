// No-op stand-in for @sentry/react in the ported city engine. The unified app
// does its error reporting on the backend (GlitchTip via the Rust Sentry
// layer); the frontend keeps the same call sites without the dependency.

type Args = unknown[];

const scope = {
  setTag: (_k: string, _v?: string) => {},
  setContext: (_k: string, _v: unknown) => {},
  setUser: (_u: unknown) => {},
};

export const logger = {
  info: (..._a: Args) => {},
  warn: (..._a: Args) => {},
  error: (..._a: Args) => {},
};

export function captureException(_e: unknown, _ctx?: unknown) {}
export function captureMessage(_m: string, _level?: string) {}
export function setUser(_u: unknown) {}
export function getIsolationScope() {
  return scope;
}
export function setTag(_k: string, _v?: string) {}
export function setContext(_k: string, _v: unknown) {}
