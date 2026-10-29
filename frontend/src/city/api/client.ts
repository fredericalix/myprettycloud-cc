import { debug } from '../utils/debug';
import { retryWithBackoff } from '../utils/retry';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Base URL of the backend. Empty in dev (Vite proxy handles /api, /auth, /ws).
 *  In production `VITE_BACKEND_URL` is set to e.g. https://mycctown-backend.cleverapps.io */
export const BACKEND_URL = '';

export function backendHref(path: string): string {
  if (!BACKEND_URL) return path;
  return `${BACKEND_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD']);
const TRANSIENT_STATUS = new Set([502, 503, 504]);

class TransientHttpError extends Error {
  constructor(public status: number) {
    super(`transient ${status}`);
  }
}

export async function api<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = backendHref(path);
  const method = (init.method ?? 'GET').toUpperCase();
  const canRetry = IDEMPOTENT_METHODS.has(method);

  const doFetch = async (): Promise<Response> => {
    const res = await fetch(url, {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      ...init,
    });
    if (canRetry && TRANSIENT_STATUS.has(res.status)) {
      throw new TransientHttpError(res.status);
    }
    return res;
  };

  const res = canRetry
    ? await retryWithBackoff(doFetch, {
        attempts: 3,
        baseDelayMs: 250,
        scope: `api:${method} ${path}`,
        // Network errors (TypeError covers ERR_HTTP2_PROTOCOL_ERROR /
        // Failed to fetch) and explicit transient HTTP statuses.
        shouldRetry: (err) =>
          err instanceof TypeError || err instanceof TransientHttpError,
      })
    : await doFetch();

  debug.log('api', `${method} ${path} → ${res.status}`);

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // ignore: body wasn't JSON
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return undefined as T;
  return (await res.json()) as T;
}
