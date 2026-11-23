import { NextResponse } from 'next/server';
import { listCached } from '@/lib/cache/report-cache';

export const dynamic = 'force-dynamic';

/**
 * Previously fetched reports straight from the local cache. Makes no Graph
 * call and needs no sign-in, so the app has data right after a restart.
 */
export async function GET() {
  const entries = await listCached();
  return NextResponse.json({
    reports: entries.map((e) => ({
      analysis: e.analysis,
      subject: e.subject,
      receivedDateTime: e.receivedDateTime,
    })),
    lastCachedAt:
      entries.reduce((max, e) => Math.max(max, e.cachedAt), 0) || null,
  });
}
