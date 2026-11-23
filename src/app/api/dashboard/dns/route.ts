import { NextResponse } from 'next/server';
import { listCached } from '@/lib/cache/report-cache';
import { getReportAddress } from '@/lib/config';
import { domainContext } from '@/lib/dashboard/aggregate';
import { checkDomainDns } from '@/lib/dns/records';

export const dynamic = 'force-dynamic';

const HOSTNAME =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/**
 * DNS health check for one domain. Only domains that appear in the cached
 * reports are accepted, so this can't be used as a generic DNS prober.
 */
export async function GET(request: Request) {
  const domain = new URL(request.url).searchParams.get('domain') ?? '';
  if (!HOSTNAME.test(domain)) {
    return NextResponse.json({ error: 'Invalid domain' }, { status: 400 });
  }

  const ctx = domainContext(await listCached(), domain);
  if (!ctx.known) {
    return NextResponse.json({ error: 'Unknown domain' }, { status: 400 });
  }

  return NextResponse.json({
    ...(await checkDomainDns(domain, {
      selectors: ctx.selectors,
      published: ctx.published,
      reportAddress: getReportAddress(),
    })),
    reportAddressConfigured: !!getReportAddress(),
  });
}
