import { NextResponse } from 'next/server';
import { listCached } from '@/lib/cache/report-cache';
import { buildOverview } from '@/lib/dashboard/overview';
import { readHistory } from '@/lib/dns/history';
import { buildReviewContext } from '@/lib/senders/resolve';
import { readState } from '@/lib/state/store';

export const dynamic = 'force-dynamic';

/**
 * Last sync, last review, what changed since, and per-domain readiness. Reads
 * the local cache and state only (no Graph call).
 */
export async function GET() {
  const [entries, state, history] = await Promise.all([
    listCached(),
    readState(),
    readHistory(),
  ]);
  const review = await buildReviewContext(entries);
  return NextResponse.json(
    buildOverview(entries, state, Date.now(), history, review),
  );
}
