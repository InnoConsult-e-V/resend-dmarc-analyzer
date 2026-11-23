import { NextResponse } from 'next/server';
import { getGraphConfig } from '@/lib/config';
import { GraphError, graphFetch, NotSignedInError } from '@/lib/graph/client';
import { readAuth } from '@/lib/graph/token-store';

export const dynamic = 'force-dynamic';

type Health =
  | { status: 'ok'; account: string | null; detail: string }
  | { status: 'signed_out' | 'not_configured' | 'error'; detail: string };

/**
 * End-to-end health check: configuration, sign-in, and whether the mailbox
 * folder is actually reachable. Details are safe to show (variable names and
 * Graph error codes only, never values or tokens).
 */
export async function GET() {
  const respond = (body: Health) => NextResponse.json(body);

  let config: ReturnType<typeof getGraphConfig>;
  try {
    config = getGraphConfig();
  } catch (err) {
    return respond({
      status: 'not_configured',
      detail:
        err instanceof Error && err.message.startsWith('Missing configuration')
          ? err.message
          : 'Configuration is invalid',
    });
  }

  const auth = await readAuth();
  if (!auth) {
    return respond({
      status: 'signed_out',
      detail: 'Sign in to read the mailbox',
    });
  }

  try {
    await graphFetch(
      `/users/${encodeURIComponent(config.mailbox)}/mailFolders/${encodeURIComponent(config.folder)}?$select=id`,
    );
    return respond({
      status: 'ok',
      account: auth.account,
      detail: `Signed in as ${auth.account}; mailbox reachable`,
    });
  } catch (err) {
    if (err instanceof NotSignedInError) {
      return respond({
        status: 'signed_out',
        detail: 'Sign-in expired, please sign in again',
      });
    }
    return respond({
      status: 'error',
      detail: err instanceof GraphError ? err.message : 'Health check failed',
    });
  }
}
