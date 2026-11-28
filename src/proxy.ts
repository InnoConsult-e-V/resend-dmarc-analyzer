import { type NextRequest, NextResponse } from 'next/server';

/**
 * Local-only guard. This app reads a real mailbox, so it must only be reached
 * from the machine it runs on. The primary control is binding to 127.0.0.1
 * (see the `dev` and `start` scripts); this is defense in depth against
 * non-loopback binds, reverse proxies, tunnels, DNS rebinding and cross-site
 * requests from other pages open in the user's browser.
 */

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

function isLoopbackIp(ip: string): boolean {
  const v = ip.trim().toLowerCase();
  return (
    v === '::1' ||
    v === '::ffff:127.0.0.1' ||
    /^127(\.\d{1,3}){3}$/.test(v) ||
    v === 'localhost'
  );
}

/**
 * Next.js itself injects x-forwarded-for/host/port/proto (all loopback) on
 * every request, so the presence of those headers is not a signal. A reverse
 * proxy or tunnel shows up as a non-loopback address or host in them, or as a
 * `Forwarded` / `X-Real-IP` header pointing elsewhere.
 */
function hasNonLocalProxyHeaders(request: NextRequest): boolean {
  const h = request.headers;

  const xff = h.get('x-forwarded-for');
  if (xff && !xff.split(',').every(isLoopbackIp)) {
    return true;
  }

  const xfHost = h.get('x-forwarded-host');
  if (xfHost && !LOOPBACK_HOSTNAMES.has(hostnameOf(xfHost).toLowerCase())) {
    return true;
  }

  const realIp = h.get('x-real-ip');
  if (realIp && !isLoopbackIp(realIp)) {
    return true;
  }

  // Next never sets the standard Forwarded header; any value is a proxy.
  return h.has('forwarded');
}

function hostnameOf(hostHeader: string): string {
  // Strip the port; keep IPv6 brackets intact.
  return hostHeader.startsWith('[')
    ? hostHeader.slice(0, hostHeader.indexOf(']') + 1)
    : hostHeader.split(':')[0];
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    // URL.hostname keeps brackets for IPv6, e.g. "[::1]".
    return LOOPBACK_HOSTNAMES.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function forbidden(reason: string) {
  // The reason is a fixed label (never request data) to make blocks diagnosable.
  return new NextResponse(`Forbidden (${reason})`, { status: 403 });
}

export function proxy(request: NextRequest) {
  const host = request.headers.get('host') ?? '';
  if (!LOOPBACK_HOSTNAMES.has(hostnameOf(host).toLowerCase())) {
    return forbidden('host');
  }

  if (hasNonLocalProxyHeaders(request)) {
    return forbidden('proxy headers');
  }

  // The OAuth redirect back from login.microsoftonline.com is a cross-site
  // top-level navigation. It is protected by the state + PKCE cookie instead.
  const isAuthCallback =
    request.method === 'GET' &&
    request.nextUrl.pathname === '/api/auth/callback';

  // Starting sign-in is a plain link click that only redirects to Microsoft
  // (state + PKCE protect the callback), so a top-level navigation from
  // another origin, e.g. a link opened from an editor or terminal, is fine.
  const isLoginNavigation =
    request.method === 'GET' &&
    request.nextUrl.pathname === '/api/auth/login' &&
    request.headers.get('sec-fetch-mode') === 'navigate';

  if (
    request.nextUrl.pathname.startsWith('/api/') &&
    !isAuthCallback &&
    !isLoginNavigation
  ) {
    const origin = request.headers.get('origin');
    if (origin && !isLoopbackOrigin(origin)) {
      return forbidden('origin');
    }
    if (request.headers.get('sec-fetch-site') === 'cross-site') {
      return forbidden('cross-site');
    }
  }

  return NextResponse.next();
}
