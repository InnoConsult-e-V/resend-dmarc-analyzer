import { NextResponse } from 'next/server';
import { listCached } from '@/lib/cache/report-cache';
import { aggregate } from '@/lib/dashboard/aggregate';

export const dynamic = 'force-dynamic';

const ALLOWED_DAYS = new Set(['7', '30', '90']);

/**
 * Aggregated dashboard data from the local cache only (no Graph call).
 * Query: ?days=7|30|90|all (default all) &domain=<domain in the cache>.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const daysParam = params.get('days') ?? 'all';
  if (daysParam !== 'all' && !ALLOWED_DAYS.has(daysParam)) {
    return NextResponse.json({ error: 'Invalid days' }, { status: 400 });
  }

  const entries = await listCached();
  const domain = params.get('domain') || null;
  const data = aggregate(entries, {
    domain: null,
    days: daysParam === 'all' ? null : Number(daysParam),
  });

  if (domain && !data.availableDomains.includes(domain)) {
    return NextResponse.json({ error: 'Unknown domain' }, { status: 400 });
  }
  if (!domain) {
    return NextResponse.json(data);
  }
  return NextResponse.json(
    aggregate(entries, {
      domain,
      days: daysParam === 'all' ? null : Number(daysParam),
    }),
  );
}
