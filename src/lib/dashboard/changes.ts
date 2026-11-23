import { formatPolicy, publishedOf } from '@/lib/dmarc/policy';
import {
  type AggregateEntry,
  aggregate,
  dedupeEntries,
  type SourceStatus,
} from './aggregate';
import { assessReadiness, type ReadinessStatus } from './readiness';

/**
 * What changed since the admin last marked the dashboard as reviewed. Reports
 * are split by when they were *received* (mailbox time), so late-delivered
 * reports about older days still count as new. Pure functions, no I/O.
 */

const DAY_MS = 86_400_000;
/** Reports from the 30 days up to the review give the "before" pass rate. */
const BEFORE_WINDOW_DAYS = 30;
/** A source needs this many messages since the review to be called "worse". */
const WORSENED_MIN_MESSAGES = 5;

export interface NewSource {
  ip: string;
  messages: number;
  status: SourceStatus;
}

export interface WorsenedSource {
  ip: string;
  from: SourceStatus;
  messages: number;
  failedBoth: number;
}

export interface DomainChange {
  domain: string;
  newReports: number;
  newMessages: number;
  /** Passed-both rate (0..100) before / after the review, null if no data. */
  rateBefore: number | null;
  rateAfter: number | null;
  rateDeltaPts: number | null;
  policyChange: { from: string; to: string } | null;
  readinessChange: { from: ReadinessStatus; to: ReadinessStatus } | null;
  newSources: NewSource[];
  worsenedSources: WorsenedSource[];
}

export interface Changes {
  /** False until the admin has marked the dashboard as reviewed once. */
  hasBaseline: boolean;
  reviewedAt: string | null;
  newReports: number;
  newMessages: number;
  domains: DomainChange[];
  /** True when a baseline exists and nothing at all changed. */
  nothingChanged: boolean;
}

const rate = (c: { messages: number; passedBoth: number }) =>
  c.messages > 0 ? (c.passedBoth / c.messages) * 100 : null;

function policyOf(entries: AggregateEntry[]): string | null {
  let best: AggregateEntry | null = null;
  for (const e of entries) {
    if (
      !best ||
      e.analysis.report.report_metadata.date_range.begin >
        best.analysis.report.report_metadata.date_range.begin
    ) {
      best = e;
    }
  }
  if (!best) {
    return null;
  }
  return formatPolicy(publishedOf(best.analysis.report.policy_published));
}

export function computeChanges(
  entries: AggregateEntry[],
  reviewedAt: string | null,
  now: number = Date.now(),
): Changes {
  if (!reviewedAt || Number.isNaN(Date.parse(reviewedAt))) {
    return {
      hasBaseline: false,
      reviewedAt: null,
      newReports: 0,
      newMessages: 0,
      domains: [],
      nothingChanged: false,
    };
  }

  const reviewedMs = Date.parse(reviewedAt);
  const { unique } = dedupeEntries(entries);
  const domains = [
    ...new Set(unique.map((e) => e.analysis.report.policy_published.domain)),
  ].sort();

  const result: DomainChange[] = [];
  for (const domain of domains) {
    const own = unique.filter(
      (e) => e.analysis.report.policy_published.domain === domain,
    );
    const after = own.filter(
      (e) => Date.parse(e.receivedDateTime) > reviewedMs,
    );
    const before = own.filter(
      (e) => Date.parse(e.receivedDateTime) <= reviewedMs,
    );
    const before30 = before.filter(
      (e) =>
        Date.parse(e.receivedDateTime) >
        reviewedMs - BEFORE_WINDOW_DAYS * DAY_MS,
    );

    const none = { domain: null, days: null } as const;
    const aggAfter = aggregate(after, none, now);
    const aggBefore = aggregate(before, none, now);
    const aggBefore30 = aggregate(before30, none, now);
    const aggAll = aggregate(own, none, now);

    const rateBefore = rate(aggBefore30.totals);
    const rateAfter = rate(aggAfter.totals);

    const beforeStatus = new Map(
      aggBefore.sources.map((s) => [s.ip, s.status]),
    );
    const newSources: NewSource[] = aggAll.sources
      .filter((s) => Date.parse(s.firstReceivedAt) > reviewedMs)
      .map((s) => ({ ip: s.ip, messages: s.messages, status: s.status }));

    const worsenedSources: WorsenedSource[] = aggAfter.sources
      .filter(
        (s) =>
          s.status === 'failing' &&
          s.messages >= WORSENED_MIN_MESSAGES &&
          beforeStatus.has(s.ip) &&
          beforeStatus.get(s.ip) !== 'failing',
      )
      .map((s) => ({
        ip: s.ip,
        from: beforeStatus.get(s.ip) as SourceStatus,
        messages: s.messages,
        failedBoth: s.failedBoth,
      }));

    const policyBefore = policyOf(before);
    const policyAfter = policyOf(after);
    const policyChange =
      policyBefore && policyAfter && policyBefore !== policyAfter
        ? { from: policyBefore, to: policyAfter }
        : null;

    let readinessChange: DomainChange['readinessChange'] = null;
    if (before.length > 0 && after.length > 0) {
      const was = assessReadiness(before, domain, reviewedMs).status;
      const is = assessReadiness(own, domain, now).status;
      if (was !== is) {
        readinessChange = { from: was, to: is };
      }
    }

    result.push({
      domain,
      newReports: after.length,
      newMessages: aggAfter.totals.messages,
      rateBefore,
      rateAfter,
      rateDeltaPts:
        rateBefore !== null && rateAfter !== null
          ? rateAfter - rateBefore
          : null,
      policyChange,
      readinessChange,
      newSources,
      worsenedSources,
    });
  }

  const newReports = result.reduce((n, d) => n + d.newReports, 0);
  const newMessages = result.reduce((n, d) => n + d.newMessages, 0);
  const anyDetail = result.some(
    (d) =>
      d.policyChange ||
      d.readinessChange ||
      d.newSources.length > 0 ||
      d.worsenedSources.length > 0,
  );

  return {
    hasBaseline: true,
    reviewedAt,
    newReports,
    newMessages,
    domains: result,
    nothingChanged: newReports === 0 && !anyDetail,
  };
}
