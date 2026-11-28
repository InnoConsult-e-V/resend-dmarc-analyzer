'use client';

import { useCallback, useEffect, useState } from 'react';

export interface AuthState {
  checked: boolean;
  signedIn: boolean;
  account: string | null;
}

export type SyncResult =
  // The response shape differs with ?slim=1, hence `any`.
  | { ok: true; data: any }
  | { ok: false; error: string; signInRequired?: boolean };

const AUTH_ERRORS: Record<string, string> = {
  denied: 'Sign-in was cancelled or denied.',
  state: 'Sign-in could not be verified. Please try again.',
  exchange: 'Sign-in failed. Please try again.',
  config: 'Sign-in is not configured (check your environment variables).',
};

/**
 * Microsoft sign-in state and the manual mailbox sync, shared by the dashboard
 * and the Reports page.
 */
export function useMailbox() {
  const [auth, setAuth] = useState<AuthState>({
    checked: false,
    signedIn: false,
    account: null,
  });
  const [syncing, setSyncing] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const loadAuth = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/status');
      const data = await res.json();
      setAuth({
        checked: true,
        signedIn: data.signedIn,
        account: data.account,
      });
    } catch {
      setAuth({ checked: true, signedIn: false, account: null });
    }
  }, []);

  useEffect(() => {
    loadAuth();
    // Surface a failed sign-in (the callback redirects with ?auth_error=...).
    const params = new URLSearchParams(window.location.search);
    const code = params.get('auth_error');
    const detail = params.get('auth_detail');
    if (code) {
      const base = AUTH_ERRORS[code] ?? 'Sign-in failed.';
      setAuthError(
        detail && /^AADSTS\d{1,7}$/.test(detail) ? `${base} (${detail})` : base,
      );
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [loadAuth]);

  const signOut = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    await loadAuth();
  }, [loadAuth]);

  const sync = useCallback(
    async (
      options: { refresh?: boolean; slim?: boolean } = {},
    ): Promise<SyncResult> => {
      setSyncing(true);
      try {
        const qs = new URLSearchParams();
        if (options.refresh) {
          qs.set('refresh', '1');
        }
        if (options.slim) {
          qs.set('slim', '1');
        }
        const res = await fetch(`/api/reports/fetch?${qs}`, { method: 'POST' });
        const data = await res.json();
        if (res.status === 401 && data.signInRequired) {
          setAuth({ checked: true, signedIn: false, account: null });
          return {
            ok: false,
            signInRequired: true,
            error: 'Please sign in to read the mailbox.',
          };
        }
        if (!res.ok) {
          return {
            ok: false,
            error: data.error ?? 'Failed to sync the mailbox',
          };
        }
        return { ok: true, data };
      } catch (err) {
        return {
          ok: false,
          error:
            err instanceof Error ? err.message : 'Failed to sync the mailbox',
        };
      } finally {
        setSyncing(false);
      }
    },
    [],
  );

  return {
    auth,
    syncing,
    sync,
    signOut,
    loadAuth,
    authError,
    clearAuthError: () => setAuthError(null),
  };
}
