import { type NextRequest, NextResponse } from 'next/server';
import { getGraphConfig } from '@/lib/config';
import { AuthError, exchangeCode } from '@/lib/graph/auth';
import { resetAccessToken } from '@/lib/graph/client';
import { writeAuth } from '@/lib/graph/token-store';

export const dynamic = 'force-dynamic';

const AUTH_COOKIE = 'dmarc_auth';

function home(
  request: NextRequest,
  error?: string,
  detail?: string,
): NextResponse {
  let origin = request.nextUrl.origin;
  try {
    origin = new URL(getGraphConfig().redirectUri).origin;
  } catch {
    // fall back to the request origin
  }
  const response = NextResponse.redirect(
    new URL(
      error
        ? `/?auth_error=${error}${detail ? `&auth_detail=${detail}` : ''}`
        : '/',
      origin,
    ),
  );
  response.cookies.delete({ name: AUTH_COOKIE, path: '/api/auth' });
  return response;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const cookie = request.cookies.get(AUTH_COOKIE)?.value ?? '';
  const [expectedState, verifier] = cookie.split('.');

  // Microsoft reported an error (e.g. the user declined). Never echo it.
  if (params.get('error')) {
    return home(request, 'denied');
  }

  const state = params.get('state');
  const code = params.get('code');
  if (
    !expectedState ||
    !verifier ||
    !state ||
    state !== expectedState ||
    !code
  ) {
    return home(request, 'state');
  }

  try {
    const result = await exchangeCode(code, verifier);
    if (!result.refreshToken) {
      return home(request, 'exchange');
    }
    await writeAuth({
      refreshToken: result.refreshToken,
      account: result.account ?? 'signed-in user',
      savedAt: Date.now(),
    });
    resetAccessToken();
    return home(request);
  } catch (err) {
    return home(
      request,
      'exchange',
      err instanceof AuthError && /^AADSTS\d{1,7}$/.test(err.code)
        ? err.code
        : undefined,
    );
  }
}
