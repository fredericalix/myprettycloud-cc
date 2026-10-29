import { debug } from './debug';

export interface RetryOpts {
  /** Total attempts including the first try. Default 3 (= 2 retries). */
  attempts?: number;
  /** Base delay in ms. Actual wait = baseDelayMs * 2^n + jitter. Default 250. */
  baseDelayMs?: number;
  /** Predicate to gate retries. Default: retry every error. */
  shouldRetry?: (err: unknown) => boolean;
  /** Tag forwarded to debug logs. */
  scope?: string;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: RetryOpts = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 250;
  const shouldRetry = opts.shouldRetry ?? (() => true);
  const scope = opts.scope ?? 'retry';

  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1 || !shouldRetry(err)) break;
      const delay = baseDelayMs * 2 ** i + Math.floor(Math.random() * baseDelayMs);
      debug.warn(scope, `attempt ${i + 1}/${attempts} failed, retrying in ${delay}ms`, err);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
