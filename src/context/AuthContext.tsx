import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Role, UserSession } from '../types';
import { addActivity } from '../services/activityLog';

export const ROLES: readonly Role[] = ['CONTROLLER', 'DISPATCHER', 'ADMIN'] as const;

export const DISPATCH_ROLES: readonly Role[] = ['DISPATCHER', 'ADMIN'];

export const roleLabel = (role: Role) =>
  role === 'CONTROLLER'
    ? 'Monitoring only'
    : role === 'DISPATCHER'
      ? 'Plan commit + strategy apply'
      : 'Full access';

export type ToastTone = 'info' | 'warn' | 'error' | 'success';

export interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

interface AuthContextValue {
  session: UserSession | null;
  login: (username: string, role: Role) => void;
  logout: () => void;
  canDispatch: boolean;
  /** True when the role may dispatch; otherwise emits a toast explaining why not. */
  guardDispatch: () => boolean;
  toasts: Toast[];
  pushToast: (message: string, tone?: ToastTone) => void;
  dismissToast: (id: number) => void;
}

const STORAGE_KEY = 'abpf.session';
const AuthContext = createContext<AuthContextValue | null>(null);

function readStored(): UserSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<UserSession>;
    return parsed && typeof parsed.username === 'string' && ROLES.includes(parsed.role as Role)
      ? { username: parsed.username, role: parsed.role as Role }
      : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<UserSession | null>(() => readStored());
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev.slice(-3), { id, tone, message }]);
      window.setTimeout(() => dismissToast(id), 4000);
    },
    [dismissToast],
  );

  const login = useCallback(
    (username: string, role: Role) => {
      const next: UserSession = { username: username.trim() || 'operator', role };
      setSession(next);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // storage unavailable — session stays in memory
      }
      addActivity('AUTH', `Signed in ${next.username} as ${next.role}`);
      pushToast(`Signed in as ${next.username} (${next.role}).`, 'success');
    },
    [pushToast],
  );

  const logout = useCallback(() => {
    setSession((prev) => {
      if (prev) addActivity('AUTH', `Signed out ${prev.username}`);
      return null;
    });
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  const canDispatch = session != null && DISPATCH_ROLES.includes(session.role);

  const guardDispatch = useCallback(() => {
    if (canDispatch) return true;
    if (!session) pushToast('Sign in as DISPATCHER or ADMIN to perform this action.', 'warn');
    else
      pushToast(
        `Permission denied — the ${session.role} role cannot perform this action (DISPATCHER/ADMIN required).`,
        'error',
      );
    return false;
  }, [canDispatch, session, pushToast]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      login,
      logout,
      canDispatch,
      guardDispatch,
      toasts,
      pushToast,
      dismissToast,
    }),
    [session, login, logout, canDispatch, guardDispatch, toasts, pushToast, dismissToast],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}