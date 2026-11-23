import { NextResponse } from 'next/server';
import { listCached } from '@/lib/cache/report-cache';
import { buildOverview } from '@/lib/dashboard/overview';
import { readState } from '@/lib/state/store';

export const dynamic = 'force-dynamic';

/**
 * Last sync, last review, what changed since, and per-domain readiness. Reads
 * the local cache and state only (no Graph call).
 */
export async function GET() {
  const [entries, state] = await Promise.all([listCached(), readState()]);
  return NextResponse.json(buildOverview(entries, state));
}
