import 'server-only';
import { AuthError, refreshAccessToken } from './auth';
import { clearAuth, readAuth, writeAuth } from './token-store';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

// Access token is cached in memory only; never written to disk or logged.
let cachedToken: { value: string; expiresAt: number } | null = null;

/**
 * Error whose message is safe to show to clients (no secrets or upstream bodies).
 */
export class GraphError extends Error {}

/** No usable sign-in: the user has to sign in (again). */
export class NotSignedInError extends GraphError {
  constructor() {
    super('Sign in required');
  }
}

export function resetAccessToken(): void {
  cachedToken = null;
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }

  const stored = await readAuth();
  if (!stored) {
    throw new NotSignedInError();
  }

  let result: Awaited<ReturnType<typeof refreshAccessToken>>;
  try {
    result = await refreshAccessToken(stored.refreshToken);
  } catch (err) {
    if (err instanceof AuthError && err.invalidGrant) {
      // Refresh token expired or revoked: require a fresh sign-in.
      await clearAuth();
      cachedToken = null;
      throw new NotSignedInError();
    }
    throw new GraphError(
      err instanceof AuthError ? err.message : 'Microsoft sign-in failed',
    );
  }

  // Refresh tokens rotate: keep the new one.
  if (result.refreshToken) {
    await writeAuth({
      refreshToken: result.refreshToken,
      account: result.account ?? stored.account,
      savedAt: Date.now(),
    });
  }
  cachedToken = {
    value: result.accessToken,
    expiresAt: Date.now() + result.expiresIn * 1000,
  };
  return cachedToken.value;
}

/**
 * Perform an authenticated Graph request. `path` may be a relative path or a
 * full @odata.nextLink URL on the Graph host.
 */
export async function graphFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = path.startsWith('https://') ? path : `${GRAPH_BASE}${path}`;
  if (!url.startsWith('https://graph.microsoft.com/')) {
    throw new GraphError('Refusing to send token to a non-Graph host');
  }

  const token = await getAccessToken();
  const res = await fetch(url, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    // Surface only Graph's short error code (e.g. ErrorInvalidUser) and which
    // step failed. Never the message or body, which can echo identifiers.
    let code = '';
    try {
      const c = ((await res.json()) as { error?: { code?: string } }).error
        ?.code;
      if (c && /^[A-Za-z0-9_]{1,64}$/.test(c)) {
        code = c;
      }
    } catch {
      // no usable body
    }
    const step = path.includes('/attachments')
      ? 'reading attachments'
      : path.includes('/mailFolders/')
        ? 'listing the mailbox folder'
        : 'calling Graph';
    throw new GraphError(
      `Microsoft Graph request failed while ${step} (HTTP ${res.status}${code ? `, ${code}` : ''})`,
    );
  }
  return res;
}
