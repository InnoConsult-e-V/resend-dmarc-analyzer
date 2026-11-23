import { type AggregateEntry, aggregate, type Counts } from './aggregate';
import { type AttentionItem, buildAttention } from './attention';
import { type Changes, computeChanges, type DnsEvent } from './changes';
import { assessReadiness, type Readiness } from './readiness';
import type { ReviewContext } from './review';

export interface OverviewDomain {
  domain: string;
  /** Totals over the readiness window (readiness.metrics.windowDays days) */
  totals: Counts;
  reports: number;
  readiness: Readiness;
  /** What needs the admin's attention (DNS items are added in the browser). */
  attention: AttentionItem[];
}

export interface Overview {
  now: string;
  sync: { lastSyncAt: string | null };
  review: { reviewedAt: string | null };
  changes: Changes;
  reports: number;
  domains: OverviewDomain[];
}

/**
 * Everything the dashboard home and the domain pages need that doesn't depend
 * on the range filter. Pure: callers supply the cache entries and saved state.
 */
export function buildOverview(
  entries: AggregateEntry[],
  state: { lastSyncAt?: string; reviewedAt?: string },
  now: number = Date.now(),
  /** DNS history per domain (entries with `at` and `changes`). */
  dnsHistory: Record<
    string,
    Array<{ at: string; changes: Array<{ summary: string }> }>
  > = {},
  review?: ReviewContext,
): Overview {
  const dnsEvents: DnsEvent[] = Object.entries(dnsHistory).flatMap(
    ([domain, list]) =>
      list.map((e) => ({ domain, at: e.at, changes: e.changes })),
  );
  const all = aggregate(entries, { domain: null, days: null }, now);
  const changes = computeChanges(
    entries,
    state.reviewedAt ?? null,
    now,
    dnsEvents,
    review,
  );
  const domains: OverviewDomain[] = all.availableDomains.map((domain) => {
    const readiness = assessReadiness(entries, domain, now, review);
    const stats = aggregate(
      entries,
      { domain, days: readiness.metrics.windowDays },
      now,
    );
    return {
      domain,
      totals: stats.totals,
      reports: stats.reports,
      readiness,
      attention: buildAttention(
        readiness,
        changes.domains.find((d) => d.domain === domain),
      ),
    };
  });

  return {
    now: new Date(now).toISOString(),
    sync: { lastSyncAt: state.lastSyncAt ?? null },
    review: { reviewedAt: state.reviewedAt ?? null },
    changes,
    reports: all.reports,
    domains,
  };
}
