import { type AggregateEntry, aggregate, type Counts } from './aggregate';
import { type Changes, computeChanges } from './changes';
import { assessReadiness, type Readiness } from './readiness';

export interface OverviewDomain {
  domain: string;
  /** Totals over the readiness window (readiness.metrics.windowDays days) */
  totals: Counts;
  reports: number;
  readiness: Readiness;
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
): Overview {
  const all = aggregate(entries, { domain: null, days: null }, now);
  const domains: OverviewDomain[] = all.availableDomains.map((domain) => {
    const readiness = assessReadiness(entries, domain, now);
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
    };
  });

  return {
    now: new Date(now).toISOString(),
    sync: { lastSyncAt: state.lastSyncAt ?? null },
    review: { reviewedAt: state.reviewedAt ?? null },
    changes: computeChanges(entries, state.reviewedAt ?? null, now),
    reports: all.reports,
    domains,
  };
}
