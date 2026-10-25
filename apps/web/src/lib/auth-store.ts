import { create } from 'zustand';
import type { PublicUser } from '@hws/shared';

interface AuthState {
  user: PublicUser | null;
  accessToken: string | null;
  /** True until the first silent refresh attempt finished. */
  booting: boolean;
  setSession: (user: PublicUser, accessToken: string) => void;
  setUser: (user: PublicUser) => void;
  clear: () => void;
  setBooting: (b: boolean) => void;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  booting: true,
  setSession: (user, accessToken) => set({ user, accessToken }),
  setUser: (user) => set({ user }),
  clear: () => set({ user: null, accessToken: null }),
  setBooting: (booting) => set({ booting }),
}));

export const isRecruiter = (u: PublicUser | null) => Boolean(u && (u.role === 'recruiter' || u.role === 'superadmin'));
export const homeFor = (u: PublicUser | null) => (!u ? '/login' : isRecruiter(u) ? '/recruiter' : '/app');
