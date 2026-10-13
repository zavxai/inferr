'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE, apiFetch } from './server-status';
import { rememberSession, forgetSession, decodeUserId } from './local-store';

// Shared across all useAuthFetch instances: if multiple requests 401 at the
// same time, they all await the same promise instead of each rotating the
// refresh token independently (which would invalidate each other).
let inflightRefresh: Promise<string | null> | null = null;

export class SessionExpiredError extends Error {
  constructor() { super('Session expired'); this.name = 'SessionExpiredError'; }
}

export { API_BASE } from './server-status';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  hasInterests?: boolean;
}

interface AuthContextValue {
  token: string | null;
  user: AuthUser | null;
  ready: boolean;
  setToken: (token: string) => void;
  signOut: () => Promise<void>;
  refreshToken: () => Promise<string | null>;
  rescheduleProactiveRefresh: (token: string) => void;
  refetchProfile: () => Promise<AuthUser | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);
  const refreshing = useRef(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stable ref so doRefresh can reference itself without a circular useCallback dep.
  const doRefreshRef = useRef<() => void>(() => {});
  // Tracks whether the latest fire-and-forget /auth/me fetch is still valid.
  // Flipped to false by signOut to prevent a racing fetch from restoring stale user data.
  const profileFetchActiveRef = useRef(false);

  const scheduleProactiveRefresh = useCallback((accessToken: string, doRefresh: () => void) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    try {
      const { exp } = JSON.parse(atob(accessToken.split('.')[1])) as { exp: number };
      const msUntilExpiry = exp * 1000 - Date.now();
      const delay = Math.max(msUntilExpiry - 60_000, 10_000);
      refreshTimerRef.current = setTimeout(doRefresh, delay);
    } catch {
      // malformed token — skip scheduling
    }
  }, []);

  const refreshToken = useCallback(async (): Promise<string | null> => {
    if (refreshing.current) return null;
    refreshing.current = true;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await apiFetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        });
        if (res.ok) {
          const data = await res.json() as { accessToken: string };
          setTokenState(data.accessToken);
          rememberSession(decodeUserId(data.accessToken));
          // Fetch profile so all navbars share user data. Guard with a ref
          // so a concurrent signOut can't restore stale user data after clearing it.
          profileFetchActiveRef.current = true;
          apiFetch(`${API_BASE}/auth/me`, {
            headers: { Authorization: `Bearer ${data.accessToken}` },
            credentials: 'include',
          }).then((r) => r.ok ? r.json() : null)
            .then((u) => { if (u && profileFetchActiveRef.current) setUser(u as AuthUser); })
            .catch(() => {});
          return data.accessToken;
        }
        // A 401 means the cookie is missing, expired, or invalid. Retrying it
        // cannot restore a session and quickly trips the server's refresh
        // throttle, which used to obscure the actual failure as a 429.
        // Retry only transient server failures (for example, a cold API).
        if (attempt === 0 && res.status >= 500) {
          await new Promise(r => setTimeout(r, 1500));
          continue;
        }
        return null;
      }
      return null;
    } catch {
      return null;
    } finally {
      refreshing.current = false;
    }
  }, []);

  const doRefresh = useCallback(() => {
    if (!inflightRefresh) {
      inflightRefresh = refreshToken().finally(() => { inflightRefresh = null; });
      inflightRefresh.then((newT) => {
        if (newT) scheduleProactiveRefresh(newT, doRefreshRef.current);
      });
    }
  }, [refreshToken, scheduleProactiveRefresh]);

  // Keep ref in sync so the timer callback (which reads doRefreshRef) always
  // invokes the latest doRefresh. Runs before the mount effect below (source
  // order), so the ref is populated before any async .then() reads it.
  useEffect(() => { doRefreshRef.current = doRefresh; }, [doRefresh]);

  const rescheduleProactiveRefresh = useCallback((t: string) => {
    scheduleProactiveRefresh(t, doRefreshRef.current);
  }, [scheduleProactiveRefresh]);

  // On mount: restore session via silent refresh
  useEffect(() => {
    if (!inflightRefresh) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      inflightRefresh = refreshToken().finally(() => { inflightRefresh = null; });
    }
    inflightRefresh.then((t) => {
      if (t) scheduleProactiveRefresh(t, doRefreshRef.current);
    }).finally(() => setReady(true));

    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setToken = useCallback((newToken: string) => {
    setTokenState(newToken);
    rememberSession(decodeUserId(newToken));
    rescheduleProactiveRefresh(newToken);
  }, [rescheduleProactiveRefresh]);

  const signOut = useCallback(async () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    profileFetchActiveRef.current = false; // cancel any in-flight /auth/me
    try {
      await apiFetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {}
    forgetSession();
    setUser(null);
    setTokenState(null);
  }, []);

  const refetchProfile = useCallback(async (): Promise<AuthUser | null> => {
    if (!token) return null;
    profileFetchActiveRef.current = true;
    try {
      const res = await apiFetch(`${API_BASE}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
      if (res.ok) {
        const u = await res.json() as AuthUser;
        if (profileFetchActiveRef.current) {
          setUser(u);
          return u;
        }
      }
      return null;
    } catch {
      return null;
    }
  }, [token]);

  return (
    <AuthContext.Provider value={{ token, user, ready, setToken, signOut, refreshToken, rescheduleProactiveRefresh, refetchProfile }}>

      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export function useAuthFetch() {
  const { token, refreshToken, signOut, rescheduleProactiveRefresh } = useAuth();
  const tokenRef = useRef(token);
  useEffect(() => { tokenRef.current = token; }, [token]);

  return useCallback(async (url: string, options: RequestInit = {}): Promise<Response> => {
    const { signal, ...optionsWithoutSignal } = options;

    const withBearer = (t: string | null, includeSignal: boolean): RequestInit => ({
      ...(includeSignal ? options : optionsWithoutSignal),
      credentials: 'include' as const,
      headers: {
        ...(options.headers as Record<string, string> | undefined),
        ...(t ? { Authorization: `Bearer ${t}` } : {}),
      },
    });

    const res = await apiFetch(url, withBearer(tokenRef.current, true));
    if (res.status !== 401) return res;

    if (!inflightRefresh) {
      inflightRefresh = refreshToken().finally(() => { inflightRefresh = null; });
    }
    const newToken = await inflightRefresh;
    if (!newToken) { await signOut(); throw new SessionExpiredError(); }

    // Re-arm the proactive timer with the new token — reactive refreshes bypass
    // the doRefresh chain, so without this the timer would never fire again.
    rescheduleProactiveRefresh(newToken);

    // Strip signal from retry: the original signal may already be aborted while
    // the refresh was in-flight, and we still want the retry to reach the server.
    const retry = await apiFetch(url, withBearer(newToken, false));
    if (retry.status === 401) { await signOut(); throw new SessionExpiredError(); }

    return retry;
  }, [refreshToken, signOut, rescheduleProactiveRefresh]);
}
