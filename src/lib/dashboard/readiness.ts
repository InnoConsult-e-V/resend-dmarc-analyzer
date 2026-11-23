import {
  effectivePolicy,
  type PublishedPolicy,
  publishedOf,
} from '@/lib/dmarc/policy';
import type { DomainDnsReport, Finding } from '@/lib/dns/records';
import type { DispositionType } from '@/types/dmarc';
import { type AggregateEntry, aggregate, dedupeEntries } from './aggregate';

/**
 * Policy readiness: is this domain ready for a stricter DMARC policy?
 *
 * Pure functions (no I/O). The metric is "survives enforcement" = share of
 * messages that did NOT fail both DKIM and SPF, because DMARC passes when
 * either aligned check passes. That is deliberately separate from the
 * headline "passed both" figure used elsewhere.
 */

export const READINESS = {
  /**
   * Look at the last 30 days; if that holds fewer than MIN_MESSAGES (a small
   * domain), widen to 60 and then 90 days so low-volume domains can still be
   * assessed. The window actually used is reported in `metrics.windowDays`.
   */
  WINDOW_STEPS: [30, 60, 90],
  MIN_REPORT_DAYS: 14,
  MIN_MESSAGES: 100,
  FRESH_DAYS: 7,
  /** Max share of messages failing both checks to move none -> quarantine. */
  QUARANTINE_MAX_FAIL: 0.02,
  /** Max share to move quarantine -> reject (and to stay healthy at reject). */
  REJECT_MAX_FAIL: 0.005,
  STABLE_DAYS_FOR_REJECT: 14,
  /** A failing source is worth a look at this many failed messages or share. */
  REVIEW_MIN_FAILED: 5,
  REVIEW_MIN_SHARE: 0.005,
  REVIEW_TOP: 5,
} as const;

const DAY_MS = 86_400_000;

export type ReadinessStatus =
  | 'insufficient_data'
  | 'not_ready'
  | 'almost'
  | 'ready'
  | 'enforced'
  | 'monitoring';

export type CheckSeverity = 'ok' | 'info' | 'warn' | 'error';

export interface ReadinessCheck {
  id: string;
  severity: CheckSeverity;
  title: string;
  message: string;
}

export interface ReviewSource {
  ip: string;
  messages: number;
  failedBoth: number;
  /** Share of the domain's messages, 0..1 */
  share: number;
  headerFrom: string[];
  externalIdentities: string[];
}

export interface Readiness {
  domain: string;
  stage: DispositionType;
  published: PublishedPolicy | null;
  status: ReadinessStatus;
  nextStep: string;
  checks: ReadinessCheck[];
  metrics: {
    windowDays: number;
    messages: number;
    reportDays: number;
    /** 0..100, or null when there are no messages */
    survivesPct: number | null;
    passedBothPct: number | null;
    failedBothPct: number | null;
    daysAtCurrentPolicy: number | null;
    lastReceivedAt: string | null;
    daysSinceLastReport: number | null;
  };
  sourcesToReview: ReviewSource[];
}

const pct = (n: number) => `${(n * 100).toFixed(n < 0.1 ? 1 : 0)}%`;
const SEVERITY_RANK: Record<CheckSeverity, number> = {
  ok: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function worstSeverity(checks: ReadinessCheck[]): CheckSeverity {
  return checks.reduce<CheckSeverity>(
    (acc, c) =>
      SEVERITY_RANK[c.severity] > SEVERITY_RANK[acc] ? c.severity : acc,
    'ok',
  );
}

/** Decide status and next step from the checks. Used again after DNS is added. */
function finalize(r: Omit<Readiness, 'status' | 'nextStep'>): Readiness {
  const { stage, checks, metrics } = r;
  const data = checks.find((c) => c.id === 'data');
  const failrate = checks.find((c) => c.id === 'failrate');
  const worst = worstSeverity(checks);
  const firstOf = (sev: CheckSeverity) =>
    checks.find((c) => c.severity === sev)?.message ?? '';

  let status: ReadinessStatus;
  let nextStep: string;

  if (data && data.severity !== 'ok') {
    status = 'insufficient_data';
    nextStep = `Keep syncing: readiness needs at least ${READINESS.MIN_REPORT_DAYS} days of reports and ${READINESS.MIN_MESSAGES} messages (${metrics.reportDays} days and ${metrics.messages} messages so far).`;
  } else if (stage === 'reject') {
    if (failrate && failrate.severity !== 'ok') {
      status = 'monitoring';
      nextStep = `Enforced, but ${failrate.message} Legitimate mail may be rejected: review the failing senders.`;
    } else {
      status = 'enforced';
      nextStep =
        'Fully enforced (p=reject). Keep syncing regularly and review any new failing senders.';
    }
  } else if (worst === 'error') {
    status = 'not_ready';
    nextStep = `Not ready to tighten the policy yet: ${firstOf('error')}`;
  } else if (worst === 'warn') {
    status = 'almost';
    nextStep = `Almost there: ${firstOf('warn')}`;
  } else {
    status = 'ready';
    const declared = r.published?.p ?? 'none';
    nextStep =
      r.published?.testing === 'y' && declared !== 'none'
        ? `Ready to enforce p=${declared}: remove t=y (or set t=n).`
        : stage === 'none'
          ? 'Ready for p=quarantine. Start with pct=25 and raise it step by step.'
          : 'Ready for p=reject.';
  }

  return { ...r, status, nextStep };
}

export function assessReadiness(
  entries: AggregateEntry[],
  domain: string,
  now: number = Date.now(),
): Readiness {
  const { unique } = dedupeEntries(entries);
  const own = unique.filter(
    (e) => e.analysis.report.policy_published.domain === domain,
  );

  // Latest published policy and how long it has been in place.
  const byBegin = [...own].sort(
    (a, b) =>
      b.analysis.report.report_metadata.date_range.begin -
      a.analysis.report.report_metadata.date_range.begin,
  );
  const latest = byBegin[0]?.analysis.report;
  const published = latest ? publishedOf(latest.policy_published) : null;
  // What receivers actually apply: p=quarantine with t=y behaves like none.
  const stage: DispositionType = published
    ? effectivePolicy(published).stage
    : 'none';

  let daysAtCurrentPolicy: number | null = null;
  if (latest) {
    let earliestBegin = latest.report_metadata.date_range.begin;
    for (const e of byBegin) {
      const r = e.analysis.report;
      if (effectivePolicy(r.policy_published).stage !== stage) {
        break;
      }
      earliestBegin = r.report_metadata.date_range.begin;
    }
    daysAtCurrentPolicy = Math.floor(
      (latest.report_metadata.date_range.end - earliestBegin) / 86_400,
    );
  }

  const lastReceivedAt = own.reduce<string | null>(
    (max, e) =>
      max === null || e.receivedDateTime > max ? e.receivedDateTime : max,
    null,
  );
  const daysSinceLastReport =
    lastReceivedAt === null
      ? null
      : Math.floor((now - Date.parse(lastReceivedAt)) / DAY_MS);

  let windowDays: number = READINESS.WINDOW_STEPS[0];
  let agg = aggregate(entries, { domain, days: windowDays }, now);
  for (const step of READINESS.WINDOW_STEPS.slice(1)) {
    if (agg.totals.messages >= READINESS.MIN_MESSAGES) {
      break;
    }
    windowDays = step;
    agg = aggregate(entries, { domain, days: windowDays }, now);
  }
  const t = agg.totals;
  const reportDays = agg.daily.filter((d) => d.messages > 0).length;
  const failShare = t.messages > 0 ? t.failedBoth / t.messages : 0;

  const checks: ReadinessCheck[] = [];

  // 1. Enough data
  const enough =
    reportDays >= READINESS.MIN_REPORT_DAYS &&
    t.messages >= READINESS.MIN_MESSAGES;
  checks.push({
    id: 'data',
    severity: enough ? 'ok' : 'warn',
    title: 'Enough data',
    message: enough
      ? `${reportDays} report days and ${t.messages.toLocaleString('en-US')} messages in the last ${windowDays} days.`
      : `Only ${reportDays} report days and ${t.messages.toLocaleString('en-US')} messages in the last ${windowDays} days (need ${READINESS.MIN_REPORT_DAYS} days and ${READINESS.MIN_MESSAGES} messages).`,
  });

  // 2. Fresh data
  const fresh =
    daysSinceLastReport !== null && daysSinceLastReport <= READINESS.FRESH_DAYS;
  checks.push({
    id: 'fresh',
    severity: fresh ? 'ok' : 'warn',
    title: 'Data is fresh',
    message:
      daysSinceLastReport === null
        ? 'No reports received yet.'
        : fresh
          ? `Last report received ${daysSinceLastReport} day(s) ago.`
          : `No new reports for ${daysSinceLastReport} days: sync the mailbox.`,
  });

  // 3. Failure rate against the limit for the next step
  const limit =
    stage === 'none'
      ? READINESS.QUARANTINE_MAX_FAIL
      : READINESS.REJECT_MAX_FAIL;
  const goal =
    stage === 'none'
      ? 'p=quarantine'
      : stage === 'quarantine'
        ? 'p=reject'
        : 'staying at p=reject';
  if (t.messages > 0) {
    const sev: CheckSeverity =
      failShare <= limit ? 'ok' : failShare <= limit * 2 ? 'warn' : 'error';
    checks.push({
      id: 'failrate',
      severity: sev,
      title: 'Messages failing both checks',
      message: `${pct(failShare)} of messages failed both DKIM and SPF (limit for ${goal}: ${pct(limit)}).`,
    });
  }

  // 4. Failing sources worth a look (advisory)
  const sourcesToReview: ReviewSource[] = agg.sources
    .filter(
      (s) =>
        s.failedBoth > 0 &&
        (s.failedBoth >= READINESS.REVIEW_MIN_FAILED ||
          s.failedBoth / t.messages >= READINESS.REVIEW_MIN_SHARE),
    )
    .slice(0, READINESS.REVIEW_TOP)
    .map((s) => ({
      ip: s.ip,
      messages: s.messages,
      failedBoth: s.failedBoth,
      share: t.messages > 0 ? s.failedBoth / t.messages : 0,
      headerFrom: s.headerFrom,
      externalIdentities: s.externalIdentities,
    }));
  checks.push({
    id: 'sources',
    severity: sourcesToReview.length > 0 ? 'info' : 'ok',
    title: 'Failing senders',
    message:
      sourcesToReview.length > 0
        ? `${sourcesToReview.length} sending source(s) fail both checks. If any are yours, fix their SPF or DKIM first; the rest are what enforcement would block.`
        : 'No sending source fails both checks in a meaningful volume.',
  });

  // 5. Policy stable long enough before reject
  if (stage === 'quarantine') {
    const days = daysAtCurrentPolicy ?? 0;
    const stable = days >= READINESS.STABLE_DAYS_FOR_REJECT;
    checks.push({
      id: 'stable',
      severity: stable ? 'ok' : 'warn',
      title: 'Policy has been stable',
      message: stable
        ? `p=quarantine has been in place for about ${days} days.`
        : `p=quarantine has only been seen for about ${days} days; wait at least ${READINESS.STABLE_DAYS_FOR_REJECT} before p=reject.`,
    });
  }

  // 6. Test mode (DMARCbis t=y): the declared policy is not applied
  if (published && published.testing === 'y' && published.p !== 'none') {
    checks.push({
      id: 'testing',
      severity: 'info',
      title: 'Test mode',
      message: `p=${published.p} is in test mode (t=y): receivers do not apply it yet. Remove t=y (or set t=n) to enforce it.`,
    });
  }

  // 7. pct (only present in reports using the original format)
  if (
    published &&
    published.testing !== 'y' &&
    published.p !== 'none' &&
    typeof published.pct === 'number' &&
    published.pct < 100
  ) {
    checks.push({
      id: 'pct',
      severity: 'warn',
      title: 'Applies to all mail',
      message: `pct=${published.pct}: the policy only applies to ${published.pct}% of mail. Raise it step by step to 100.`,
    });
  }

  return finalize({
    domain,
    stage,
    published,
    checks,
    metrics: {
      windowDays,
      messages: t.messages,
      reportDays,
      survivesPct: t.messages > 0 ? (1 - failShare) * 100 : null,
      passedBothPct: t.messages > 0 ? (t.passedBoth / t.messages) * 100 : null,
      failedBothPct: t.messages > 0 ? failShare * 100 : null,
      daysAtCurrentPolicy,
      lastReceivedAt,
      daysSinceLastReport,
    },
    sourcesToReview,
  });
}

type DnsInput = Pick<DomainDnsReport, 'dmarc' | 'spf' | 'dkim'>;

function dnsCheck(
  id: string,
  title: string,
  findings: Finding[],
  cap: CheckSeverity,
): ReadinessCheck {
  // Cap how much a DNS finding can hold back readiness, and show the worst one.
  const adjusted = findings.map((f) => {
    let severity: CheckSeverity = f.severity;
    if (f.message.includes('rua=')) {
      severity =
        SEVERITY_RANK[severity] > SEVERITY_RANK.warn ? 'warn' : severity;
    }
    if (f.message.includes('~all') || f.message.includes('p=none')) {
      severity = 'info';
    }
    if (SEVERITY_RANK[severity] > SEVERITY_RANK[cap]) {
      severity = cap;
    }
    return { ...f, severity };
  });
  if (adjusted.length === 0) {
    return { id, severity: 'ok', title, message: 'Nothing to report.' };
  }
  const top = adjusted.reduce((a, b) =>
    SEVERITY_RANK[b.severity] > SEVERITY_RANK[a.severity] ? b : a,
  );
  return { id, severity: top.severity, title, message: top.message };
}

/** Add the (asynchronously loaded) DNS findings and recompute status and next step. */
export function withDns(readiness: Readiness, dns: DnsInput): Readiness {
  const base = readiness.checks.filter((c) => !c.id.startsWith('dns-'));
  const checks = [
    ...base,
    dnsCheck('dns-dmarc', 'DMARC record', dns.dmarc.findings, 'error'),
    dnsCheck('dns-spf', 'SPF record', dns.spf.findings, 'error'),
    ...(dns.dkim.length > 0
      ? [
          dnsCheck(
            'dns-dkim',
            'DKIM keys',
            dns.dkim.flatMap((d) => d.findings),
            'info',
          ),
        ]
      : []),
  ];
  const { status: _s, nextStep: _n, ...rest } = readiness;
  return finalize({ ...rest, checks });
}
