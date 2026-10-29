import * as Sentry from '@/city/utils/sentry-shim';
import { create } from 'zustand';
import { fetchMe, logout as apiLogout, UserInfo } from '../api/auth';
import { ApiError } from '../api/client';

type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'anonymous' | 'error';

interface AuthState {
  status: AuthStatus;
  user: UserInfo | null;
  error: string | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'idle',
  user: null,
  error: null,
  refresh: async () => {
    set({ status: 'loading', error: null });
    try {
      const user = await fetchMe();
      Sentry.setUser({ id: user.id, email: user.email ?? undefined });
      set({ status: 'authenticated', user, error: null });
    } catch (e) {
      Sentry.setUser(null);
      if (e instanceof ApiError && e.status === 401) {
        set({ status: 'anonymous', user: null, error: null });
      } else {
        set({
          status: 'error',
          user: null,
          error: e instanceof Error ? e.message : 'unknown error',
        });
      }
    }
  },
  logout: async () => {
    try {
      await apiLogout();
    } finally {
      Sentry.setUser(null);
      set({ status: 'anonymous', user: null, error: null });
    }
  },
}));
