import { externalDomains } from '@/lib/dmarc/identity';
import type { DispositionType, DMARCAnalysis } from '@/types/dmarc';

/**
 * Cross-report aggregation for the dashboard. Pure functions (no I/O) so they
 * are easy to test. Everything is count-weighted, using policy_evaluated like
 * analyzeDMARCReport does.
 *
 * Metric: a message "passed both" when aligned DKIM and SPF both passed, "passed
 * one" when exactly one did, and "failed both" when neither did. The headline
 * pass rate is passedBoth / messages (the same definition as the per-report
 * card). Days are UTC days of the report's date_range.begin.
 */

export interface AggregateEntry {
  analysis: DMARCAnalysis;
  subject: string;
  receivedDateTime: string;
}

export interface Counts {
  messages: number;
  passedBoth: number;
  passedOne: number;
  failedBoth: number;
  /** Records without policy_evaluated: counted in `messages` only. */
  unevaluated: number;
  quarantined: number;
  rejected: number;
}

export type SourceStatus = 'healthy' | 'mixed' | 'failing';

export interface DayBucket extends Counts {
  /** UTC day, YYYY-MM-DD */
  date: string;
}

export interface DomainStats extends Counts {
  domain: string;
  p: DispositionType;
  sp: DispositionType;
  pct: number;
  reports: number;
  lastReportAt: string;
}

export interface SourceStats extends Counts {
  ip: string;
  status: SourceStatus;
  headerFrom: string[];
  /** MAIL FROM domains (only when the reporter supplies envelope_from). */
  envelopeFrom: string[];
  /** The policy domains of the reports this source appeared in. */
  policyDomains: string[];
  /**
   * Identity domains (From, DKIM d=, SPF, envelope-from) that do not belong to
   * any of the policy domains: typically third-party senders, sometimes spoofing.
   */
  externalIdentities: string[];
  reporters: string[];
  dkimDomains: string[];
  dkimSelectors: string[];
  spfDomains: string[];
  firstSeen: string;
  lastSeen: string;
}

export interface ReporterStats {
  org: string;
  reports: number;
  messages: number;
}

export interface DashboardFilter {
  /** null = all domains */
  domain: string | null;
  /** null = all time */
  days: number | null;
}

export interface DashboardData {
  generatedAt: string;
  filter: DashboardFilter;
  availableDomains: string[];
  reports: number;
  duplicatesSkipped: number;
  totals: Counts;
  daily: DayBucket[];
  domains: DomainStats[];
  sources: SourceStats[];
  reporters: ReporterStats[];
}

// Source status thresholds (share of the source's messages).
export const HEALTHY_MIN_PASSED_BOTH = 0.95;
export const FAILING_MIN_FAILED_BOTH = 0.5;

const DAY_MS = 86_400_000;
const MAX_DAILY_BUCKETS = 400;

export function emptyCounts(): Counts {
  return {
    messages: 0,
    passedBoth: 0,
    passedOne: 0,
    failedBoth: 0,
    unevaluated: 0,
    quarantined: 0,
    rejected: 0,
  };
}

function addCounts(target: Counts, from: Counts): void {
  target.messages += from.messages;
  target.passedBoth += from.passedBoth;
  target.passedOne += from.passedOne;
  target.failedBoth += from.failedBoth;
  target.unevaluated += from.unevaluated;
  target.quarantined += from.quarantined;
  target.rejected += from.rejected;
}

export function utcDay(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

export function classifySource(c: Counts): SourceStatus {
  if (c.messages === 0) {
    return 'mixed';
  }
  if (c.passedBoth / c.messages >= HEALTHY_MIN_PASSED_BOTH) {
    return 'healthy';
  }
  if (c.failedBoth / c.messages >= FAILING_MIN_FAILED_BOTH) {
    return 'failing';
  }
  return 'mixed';
}

/** Newest first, then keep the first occurrence of each org_name + report_id. */
export function dedupeEntries(entries: AggregateEntry[]): {
  unique: AggregateEntry[];
  duplicatesSkipped: number;
} {
  const sorted = [...entries].sort((a, b) =>
    b.receivedDateTime.localeCompare(a.receivedDateTime),
  );
  const seen = new Set<string>();
  const unique: AggregateEntry[] = [];
  for (const entry of sorted) {
    const m = entry.analysis.report.report_metadata;
    const key = `${m.org_name}\u0000${m.report_id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(entry);
  }
  return { unique, duplicatesSkipped: entries.length - unique.length };
}

function countsForRecord(
  count: number,
  policy: { dkim: string; spf: string; disposition: string } | undefined,
): Counts {
  const c = emptyCounts();
  c.messages = count;
  if (!policy) {
    c.unevaluated = count;
    return c;
  }
  const dkim = policy.dkim === 'pass';
  const spf = policy.spf === 'pass';
  if (dkim && spf) {
    c.passedBoth = count;
  } else if (dkim || spf) {
    c.passedOne = count;
  } else {
    c.failedBoth = count;
  }
  if (policy.disposition === 'quarantine') {
    c.quarantined = count;
  } else if (policy.disposition === 'reject') {
    c.rejected = count;
  }
  return c;
}

function sortedSet(set: Set<string>): string[] {
  return [...set].sort();
}

export function aggregate(
  entries: AggregateEntry[],
  filter: DashboardFilter,
  now: number = Date.now(),
): DashboardData {
  const { unique, duplicatesSkipped } = dedupeEntries(entries);

  const availableDomains = sortedSet(
    new Set(unique.map((e) => e.analysis.report.policy_published.domain)),
  );

  const since = filter.days === null ? null : now - filter.days * DAY_MS;
  const inScope = unique.filter((e) => {
    const r = e.analysis.report;
    if (filter.domain && r.policy_published.domain !== filter.domain) {
      return false;
    }
    return since === null || r.report_metadata.date_range.begin * 1000 >= since;
  });

  const totals = emptyCounts();
  const byDay = new Map<string, DayBucket>();
  const byDomain = new Map<string, DomainStats>();
  const bySource = new Map<
    string,
    SourceStats & {
      _from: Set<string>;
      _efrom: Set<string>;
      _pdom: Set<string>;
      _rep: Set<string>;
      _dkd: Set<string>;
      _dks: Set<string>;
      _spf: Set<string>;
    }
  >();
  const byReporter = new Map<string, ReporterStats>();

  for (const entry of inScope) {
    const { report } = entry.analysis;
    const meta = report.report_metadata;
    const day = utcDay(meta.date_range.begin);
    const reportEnd = new Date(meta.date_range.end * 1000).toISOString();

    const dayBucket = byDay.get(day) ?? { date: day, ...emptyCounts() };
    byDay.set(day, dayBucket);

    const domain = report.policy_published.domain;
    const dom =
      byDomain.get(domain) ??
      ({
        domain,
        p: report.policy_published.p,
        sp: report.policy_published.sp,
        pct: report.policy_published.pct,
        reports: 0,
        lastReportAt: '',
        ...emptyCounts(),
      } satisfies DomainStats);
    dom.reports += 1;
    // Entries are newest-received first, so the first one seen defines the
    // domain's latest published policy.
    if (!byDomain.has(domain)) {
      byDomain.set(domain, dom);
    }
    if (reportEnd > dom.lastReportAt) {
      dom.lastReportAt = reportEnd;
    }

    const reporter = byReporter.get(meta.org_name) ?? {
      org: meta.org_name,
      reports: 0,
      messages: 0,
    };
    reporter.reports += 1;
    byReporter.set(meta.org_name, reporter);

    for (const record of report.record) {
      const c = countsForRecord(record.row.count, record.row.policy_evaluated);
      addCounts(totals, c);
      addCounts(dayBucket, c);
      addCounts(dom, c);
      reporter.messages += c.messages;

      const ip = record.row.source_ip;
      const src =
        bySource.get(ip) ??
        ({
          ip,
          status: 'mixed',
          headerFrom: [],
          envelopeFrom: [],
          policyDomains: [],
          externalIdentities: [],
          reporters: [],
          dkimDomains: [],
          dkimSelectors: [],
          spfDomains: [],
          firstSeen: reportEnd,
          lastSeen: reportEnd,
          ...emptyCounts(),
          _from: new Set<string>(),
          _efrom: new Set<string>(),
          _pdom: new Set<string>(),
          _rep: new Set<string>(),
          _dkd: new Set<string>(),
          _dks: new Set<string>(),
          _spf: new Set<string>(),
        } as SourceStats & {
          _from: Set<string>;
          _efrom: Set<string>;
          _pdom: Set<string>;
          _rep: Set<string>;
          _dkd: Set<string>;
          _dks: Set<string>;
          _spf: Set<string>;
        });
      bySource.set(ip, src);
      addCounts(src, c);
      if (reportEnd < src.firstSeen) {
        src.firstSeen = reportEnd;
      }
      if (reportEnd > src.lastSeen) {
        src.lastSeen = reportEnd;
      }
      src._from.add(record.identifiers.header_from);
      if (record.identifiers.envelope_from) {
        src._efrom.add(record.identifiers.envelope_from);
      }
      src._pdom.add(domain);
      src._rep.add(meta.org_name);
      for (const d of record.auth_results.dkim ?? []) {
        src._dkd.add(d.domain);
        if (d.selector) {
          src._dks.add(d.selector);
        }
      }
      for (const s of record.auth_results.spf ?? []) {
        src._spf.add(s.domain);
      }
    }
  }

  const sources: SourceStats[] = [...bySource.values()]
    .map(({ _from, _efrom, _pdom, _rep, _dkd, _dks, _spf, ...src }) => ({
      ...src,
      status: classifySource(src),
      headerFrom: sortedSet(_from),
      envelopeFrom: sortedSet(_efrom),
      policyDomains: sortedSet(_pdom),
      externalIdentities: externalDomains(
        [..._from, ..._efrom, ..._dkd, ..._spf],
        [..._pdom],
      ),
      reporters: sortedSet(_rep),
      dkimDomains: sortedSet(_dkd),
      dkimSelectors: sortedSet(_dks),
      spfDomains: sortedSet(_spf),
    }))
    // Worst first: most messages that failed both, then volume.
    .sort((a, b) => b.failedBoth - a.failedBoth || b.messages - a.messages);

  return {
    generatedAt: new Date(now).toISOString(),
    filter,
    availableDomains,
    reports: inScope.length,
    duplicatesSkipped,
    totals,
    daily: fillDays([...byDay.values()]),
    domains: [...byDomain.values()].sort((a, b) => b.messages - a.messages),
    sources,
    reporters: [...byReporter.values()].sort((a, b) => b.messages - a.messages),
  };
}

/** Continuous UTC days from the first to the last bucket (gaps = zero rows). */
function fillDays(buckets: DayBucket[]): DayBucket[] {
  if (buckets.length === 0) {
    return [];
  }
  const sorted = [...buckets].sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map(sorted.map((b) => [b.date, b]));
  const start = Date.parse(`${sorted[0].date}T00:00:00Z`);
  const end = Date.parse(`${sorted[sorted.length - 1].date}T00:00:00Z`);
  const out: DayBucket[] = [];
  for (let t = start; t <= end && out.length < MAX_DAILY_BUCKETS; t += DAY_MS) {
    const date = new Date(t).toISOString().slice(0, 10);
    out.push(byDate.get(date) ?? { date, ...emptyCounts() });
  }
  return out;
}

/** DKIM selectors and the latest published policy for one domain (for the DNS check). */
export function domainContext(
  entries: AggregateEntry[],
  domain: string,
): {
  known: boolean;
  selectors: string[];
  published: { p: DispositionType; sp: DispositionType; pct: number } | null;
} {
  const { unique } = dedupeEntries(entries);
  const selectors = new Set<string>();
  let published: ReturnType<typeof domainContext>['published'] = null;
  let known = false;
  for (const e of unique) {
    const r = e.analysis.report;
    if (r.policy_published.domain !== domain) {
      continue;
    }
    known = true;
    published ??= {
      p: r.policy_published.p,
      sp: r.policy_published.sp,
      pct: r.policy_published.pct,
    };
    for (const rec of r.record) {
      for (const d of rec.auth_results.dkim ?? []) {
        if (d.selector && d.domain.toLowerCase() === domain.toLowerCase()) {
          selectors.add(d.selector);
        }
      }
    }
  }
  return { known, selectors: sortedSet(selectors).slice(0, 20), published };
}

/** All source IPs present in the entries (allowlist for the PTR lookup endpoint). */
export function collectSourceIps(entries: AggregateEntry[]): Set<string> {
  const ips = new Set<string>();
  for (const e of entries) {
    for (const rec of e.analysis.report.record) {
      ips.add(rec.row.source_ip);
    }
  }
  return ips;
}
