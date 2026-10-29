import { api } from './client';

export interface UserInfo {
  id: string;
  cc_user_id: string;
  email: string | null;
  display_name: string | null;
  created_at: string;
  last_login_at: string;
}

export function fetchMe(): Promise<UserInfo> {
  return api<UserInfo>('/api/me');
}

export function logout(): Promise<void> {
  return api<void>('/auth/logout', { method: 'POST' });
}
