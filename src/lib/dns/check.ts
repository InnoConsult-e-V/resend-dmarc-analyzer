import 'server-only';
import { getReportAddress } from '@/lib/config';
import {
  type AggregateEntry,
  aggregate,
  domainContext,
} from '@/lib/dashboard/aggregate';
import { recordSnapshot, snapshotOf } from './history';
import { checkDomainDns, type DomainDnsReport } from './records';

export type DomainCheckResult = DomainDnsReport & {
  reportAddressConfigured: boolean;
};

/**
 * Run the DNS check for a domain that appears in the cached reports (selectors
 * and the published policy come from the reports). Null for unknown domains.
 */
export async function runDomainCheck(
  entries: AggregateEntry[],
  domain: string,
): Promise<DomainCheckResult | null> {
  const ctx = domainContext(entries, domain);
  if (!ctx.known) {
    return null;
  }
  const reportAddress = getReportAddress();
  const report = await checkDomainDns(domain, {
    selectors: ctx.selectors,
    published: ctx.published,
    reportAddress,
  });
  return { ...report, reportAddressConfigured: !!reportAddress };
}

/** Run the check and store a snapshot if the DNS state changed. */
export async function checkAndRecord(
  entries: AggregateEntry[],
  domain: string,
): Promise<DomainCheckResult | null> {
  const result = await runDomainCheck(entries, domain);
  if (result) {
    try {
      await recordSnapshot(result, snapshotOf(result));
    } catch {
      console.warn('[dns] could not record the DNS snapshot');
    }
  }
  return result;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/**
 * After a sync: check every cached domain in parallel and record changes.
 * Never throws and never takes longer than `budgetMs`, so it cannot hold up
 * or fail a sync.
 */
export async function snapshotAllDomains(
  entries: AggregateEntry[],
  budgetMs = 10_000,
): Promise<void> {
  try {
    const { availableDomains } = aggregate(entries, {
      domain: null,
      days: null,
    });
    await Promise.all(
      availableDomains.map((d) =>
        withTimeout(checkAndRecord(entries, d), budgetMs),
      ),
    );
  } catch {
    console.warn('[dns] snapshot step failed');
  }
}
