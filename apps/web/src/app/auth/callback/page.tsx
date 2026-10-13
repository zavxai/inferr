'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, API_BASE } from '@/src/lib/auth-context';
import { apiFetch } from '@/src/lib/server-status';

function AuthCallbackContent() {
  const router = useRouter();
  const { ready, token, refreshToken } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!ready) return;

    let cancelled = false;

    const complete = async () => {
      setError(null);
      // AuthProvider's mount-time refresh may have already run before OAuth
      // (e.g. user clicked login from the landing page). In that case token is
      // null here even though the OAuth cookie is now set. Retry explicitly.
      let accessToken = token;
      if (!accessToken) {
        accessToken = await refreshToken();
      }
      if (!accessToken) {
        // A refresh failure is not necessarily an invalid Google sign-in. For
        // example, the API can still be waking up behind the public tunnel.
        // Keeping the user here avoids an indistinguishable redirect loop.
        if (!cancelled) {
          setError('We could not establish your session. Please retry in a moment.');
        }
        return;
      }
      try {
        const r = await apiFetch(`${API_BASE}/auth/me`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          credentials: 'include',
        });
        if (!r.ok) throw new Error('Could not load the authenticated profile');
        const user = await r.json() as { hasInterests: boolean };
        if (!cancelled) router.replace(user.hasInterests ? '/feed' : '/onboarding');
      } catch {
        if (!cancelled) {
          setError('Your sign-in completed, but we could not load your account. Please retry.');
        }
      }
    };

    complete();
    return () => { cancelled = true; };
  }, [ready, retryKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const retry = useCallback(() => setRetryKey((key) => key + 1), []);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-gray-900 to-gray-800">
      <div className="text-center">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-white mb-4"></div>
        {error ? (
          <>
            <p className="text-white text-lg">{error}</p>
            <button
              type="button"
              onClick={retry}
              className="mt-4 rounded bg-white px-4 py-2 text-sm font-medium text-gray-900"
            >
              Retry sign in
            </button>
          </>
        ) : (
          <p className="text-white text-lg">Completing sign in...</p>
        )}
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return <AuthCallbackContent />;
}
