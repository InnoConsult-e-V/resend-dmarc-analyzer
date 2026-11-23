import 'server-only';
import { type AggregateEntry, aggregate } from '@/lib/dashboard/aggregate';
import type { ReviewContext } from '@/lib/dashboard/review';
import { cachedPtrs } from '@/lib/dns/reverse';
import { readDecisions } from './decisions';
import { reviewOf, type ServiceInfo } from './keys';
import { lookupService } from './name-map';

/**
 * Identify the service behind each source IP using the identities in the
 * cached reports (and a reverse-DNS name when one is available).
 */
export function identifyServices(
  entries: AggregateEntry[],
  ptrHostByIp: Record<string, string | null> = {},
  onlyIps?: string[],
): Record<string, ServiceInfo | null> {
  const { sources } = aggregate(entries, { domain: null, days: null });
  const wanted = onlyIps ? new Set(onlyIps) : null;
  const out: Record<string, ServiceInfo | null> = {};
  for (const s of sources) {
    if (wanted && !wanted.has(s.ip)) {
      continue;
    }
    out[s.ip] = lookupService({
      ptrHost: ptrHostByIp[s.ip] ?? null,
      dkimDomains: s.dkimDomains,
      spfDomains: s.spfDomains,
      envelopeFrom: s.envelopeFrom,
      ownDomains: s.policyDomains,
    });
  }
  return out;
}

/**
 * Review context for the dashboard: services (from the reports plus cached
 * reverse-DNS names only, so it never waits on DNS) and the admin's decisions.
 */
export async function buildReviewContext(
  entries: AggregateEntry[],
): Promise<ReviewContext> {
  const { sources } = aggregate(entries, { domain: null, days: null });
  const ptr = await cachedPtrs(sources.map((s) => s.ip));
  const ptrHosts = Object.fromEntries(
    Object.entries(ptr).map(([ip, p]) => [ip, p.ptr]),
  );
  const services = identifyServices(entries, ptrHosts);
  const decisions = await readDecisions();

  const reviewByIp: ReviewContext['reviewByIp'] = {};
  const serviceByIp: ReviewContext['serviceByIp'] = {};
  for (const s of sources) {
    const svc = services[s.ip] ?? null;
    reviewByIp[s.ip] = reviewOf(s.ip, svc, decisions);
    serviceByIp[s.ip] = svc ? { name: svc.name, type: svc.type } : null;
  }
  return { reviewByIp, serviceByIp };
}
