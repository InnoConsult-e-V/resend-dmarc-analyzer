import { isIP } from 'node:net';
import { NextResponse } from 'next/server';
import { listCached } from '@/lib/cache/report-cache';
import { collectSourceIps } from '@/lib/dashboard/aggregate';
import { MAX_IPS_PER_REQUEST, reverseLookup } from '@/lib/dns/reverse';
import { primaryKey } from '@/lib/senders/keys';
import { identifyServices } from '@/lib/senders/resolve';

export const dynamic = 'force-dynamic';

/**
 * Forward-confirmed reverse DNS for source IPs. Only IPs that appear in the
 * cached reports are accepted, so this can't be used to probe arbitrary hosts.
 */
export async function POST(request: Request) {
  let ips: unknown;
  try {
    ips = ((await request.json()) as { ips?: unknown }).ips;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (
    !Array.isArray(ips) ||
    ips.length === 0 ||
    ips.length > MAX_IPS_PER_REQUEST ||
    !ips.every((ip) => typeof ip === 'string' && isIP(ip) !== 0)
  ) {
    return NextResponse.json(
      { error: `Provide 1-${MAX_IPS_PER_REQUEST} valid IP addresses` },
      { status: 400 },
    );
  }

  const entries = await listCached();
  const known = collectSourceIps(entries);
  if (!(ips as string[]).every((ip) => known.has(ip))) {
    return NextResponse.json({ error: 'Unknown IP address' }, { status: 400 });
  }

  const ptrs = await reverseLookup(ips as string[]);
  const services = identifyServices(
    entries,
    Object.fromEntries(ptrs.map((p) => [p.ip, p.ptr])),
    ips as string[],
  );
  return NextResponse.json({
    results: ptrs.map((p) => {
      const service = services[p.ip] ?? null;
      return { ...p, service, key: primaryKey(p.ip, service) };
    }),
  });
}
