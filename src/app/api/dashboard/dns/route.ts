import { NextResponse } from 'next/server';
import { listCached } from '@/lib/cache/report-cache';
import { checkAndRecord } from '@/lib/dns/check';
import { readHistory } from '@/lib/dns/history';

export const dynamic = 'force-dynamic';

const HOSTNAME =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

const HISTORY_SHOWN = 20;

/**
 * DNS health check for one domain, plus its recent DNS change history. Only
 * domains that appear in the cached reports are accepted, so this can't be
 * used as a generic DNS prober. Each check also records a snapshot when the
 * DNS state changed.
 */
export async function GET(request: Request) {
  const domain = new URL(request.url).searchParams.get('domain') ?? '';
  if (!HOSTNAME.test(domain)) {
    return NextResponse.json({ error: 'Invalid domain' }, { status: 400 });
  }

  const result = await checkAndRecord(await listCached(), domain);
  if (!result) {
    return NextResponse.json({ error: 'Unknown domain' }, { status: 400 });
  }

  const entries = (await readHistory())[domain] ?? [];
  return NextResponse.json({
    ...result,
    history: entries
      .slice(-HISTORY_SHOWN)
      .reverse()
      .map(({ at, changes, baseline }) => ({
        at,
        changes,
        baseline: !!baseline,
      })),
  });
}
