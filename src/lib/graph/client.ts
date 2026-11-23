import 'server-only';
import { getGraphConfig } from '@/lib/config';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

// Token is cached in memory only; never written to disk or logged.
let cachedToken: { value: string; expiresAt: number } | null = null;

/**
 * Error whose message is safe to show to clients (no secrets or upstream bodies).
 */
export class GraphError extends Error {}

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }

  const { tenantId, clientId, clientSecret } = getGraphConfig();
  const res = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }),
    },
  );

  if (!res.ok) {
    // Do not include the response body: it can echo identifiers.
    throw new GraphError(
      `Microsoft authentication failed (HTTP ${res.status})`,
    );
  }

  const json = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
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
    throw new GraphError(`Microsoft Graph request failed (HTTP ${res.status})`);
  }
  return res;
}
