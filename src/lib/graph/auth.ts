import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { getGraphConfig } from '@/lib/config';

/**
 * Delegated sign-in with the authorization code flow + PKCE (public client:
 * there is no client secret). Tokens are never logged and error messages never
 * include provider response bodies.
 */

export const SCOPES = [
  'openid',
  'profile',
  'offline_access',
  'https://graph.microsoft.com/Mail.Read',
  'https://graph.microsoft.com/Mail.Read.Shared',
].join(' ');

/** Safe-to-show error for sign-in failures. */
export class AuthError extends Error {
  constructor(
    message: string,
    /** True when Microsoft says the refresh token is no longer valid. */
    readonly invalidGrant = false,
  ) {
    super(message);
  }
}

export interface TokenResult {
  accessToken: string;
  expiresIn: number;
  refreshToken?: string;
  account?: string;
}

function base64url(buf: Buffer): string {
  return buf.toString('base64url');
}

export function challengeFor(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}

export function createPkce(): {
  verifier: string;
  challenge: string;
  state: string;
} {
  const verifier = base64url(randomBytes(32));
  return {
    verifier,
    challenge: challengeFor(verifier),
    state: base64url(randomBytes(16)),
  };
}

function authority(): string {
  const { tenantId } = getGraphConfig();
  return `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0`;
}

export function buildAuthorizeUrl(state: string, challenge: string): string {
  const { clientId, redirectUri } = getGraphConfig();
  const url = new URL(`${authority()}/authorize`);
  url.search = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return url.toString();
}

/** Display name only; the id_token comes straight from the token endpoint. */
function accountFromIdToken(idToken: string | undefined): string | undefined {
  try {
    const payload = JSON.parse(
      Buffer.from((idToken ?? '').split('.')[1], 'base64url').toString(),
    );
    return payload.preferred_username || payload.email || payload.name;
  } catch {
    return undefined;
  }
}

async function tokenRequest(params: Record<string, string>) {
  const { clientId } = getGraphConfig();
  const res = await fetch(`${authority()}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      scope: SCOPES,
      ...params,
    }),
  });

  if (!res.ok) {
    let invalidGrant = false;
    try {
      invalidGrant =
        ((await res.json()) as { error?: string }).error === 'invalid_grant';
    } catch {
      // ignore: body is never surfaced
    }
    throw new AuthError(
      `Microsoft sign-in failed (HTTP ${res.status})`,
      invalidGrant,
    );
  }

  const json = (await res.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    id_token?: string;
  };
  const result: TokenResult = {
    accessToken: json.access_token,
    expiresIn: json.expires_in,
    refreshToken: json.refresh_token,
    account: accountFromIdToken(json.id_token),
  };
  return result;
}

export function exchangeCode(code: string, verifier: string) {
  const { redirectUri } = getGraphConfig();
  return tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
}

export function refreshAccessToken(refreshToken: string) {
  return tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
}
