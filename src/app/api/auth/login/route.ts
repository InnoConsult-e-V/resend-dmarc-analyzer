import { type NextRequest, NextResponse } from 'next/server';
import { getGraphConfig } from '@/lib/config';
import { buildAuthorizeUrl, createPkce } from '@/lib/graph/auth';

export const dynamic = 'force-dynamic';

const AUTH_COOKIE = 'dmarc_auth';

export async function GET(request: NextRequest) {
  let redirect: URL;
  try {
    redirect = new URL(getGraphConfig().redirectUri);
  } catch {
    return NextResponse.redirect(new URL('/?auth_error=config', request.url));
  }

  // The PKCE cookie must be set on the same host the callback will arrive on
  // (e.g. localhost, not 127.0.0.1), so hop to the redirect host first.
  const host = request.headers.get('host') ?? '';
  if (host !== redirect.host) {
    return NextResponse.redirect(new URL('/api/auth/login', redirect.origin));
  }

  const { verifier, challenge, state } = createPkce();
  const response = NextResponse.redirect(buildAuthorizeUrl(state, challenge));
  response.cookies.set(AUTH_COOKIE, `${state}.${verifier}`, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: 600,
  });
  return response;
}
