// Thin fetch client. All requests are same-origin — in prod the static export
// is served by frontend/server.mjs (Express + http-proxy-middleware), which
// reverse-proxies /api /auth /ws … to the backend — so cookies ride along
// automatically.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const body = await res.json();
      msg = body.error ?? msg;
    } catch {
      /* non-JSON body */
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface Me {
  id: string;
  cc_user_id: string;
  email: string | null;
  display_name: string | null;
}

export interface Org {
  id: string;
  name: string;
  description?: string | null;
  avatar?: string | null;
}
