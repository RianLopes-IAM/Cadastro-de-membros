import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AuthError, authApi } from '../../services/auth';
import type { AuthSession, LoginCredentials } from '../../services/auth';
import { AuthContext } from './auth-context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const revision = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    authApi.me(controller.signal)
      .then(next => { if (!controller.signal.aborted) setSession(next); })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && !(error instanceof AuthError && error.status === 401)) {
          setConnectionError(error instanceof Error ? error.message : 'Não foi possível verificar sua sessão.');
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!session) return;
    const timeout = window.setTimeout(() => setSession(null), Math.max(0, Date.parse(session.expiresAt) - Date.now()));
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      const currentRevision = revision.current;
      authApi.me().then(next => { if (revision.current === currentRevision) setSession(next); }).catch((error: unknown) => {
        if (revision.current === currentRevision && error instanceof AuthError && error.status === 401) setSession(null);
      });
    };
    document.addEventListener('visibilitychange', refresh);
    return () => { window.clearTimeout(timeout); document.removeEventListener('visibilitychange', refresh); };
  }, [session]);

  async function login(credentials: LoginCredentials) {
    revision.current += 1;
    const nextSession = await authApi.login(credentials);
    setSession(nextSession);
    setConnectionError(null);
  }

  async function logout() {
    revision.current += 1;
    await authApi.logout();
    setSession(null);
  }

  return <AuthContext.Provider value={{ session, loading, connectionError, login, logout }}>{children}</AuthContext.Provider>;
}
