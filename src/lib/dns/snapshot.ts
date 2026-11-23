import { parseTags, splitSpfTerms } from './record-text';

/**
 * Pure helpers: a comparable snapshot of a domain's DNS authentication state,
 * and a human-readable diff between two snapshots. No I/O, so they run on both
 * the server and in tests.
 */

export interface DnsSnapshot {
  dmarc: string | null;
  spf: string | null;
  dkim: Record<
    string,
    { present: boolean; bits: number | null; fingerprint: string | null }
  >;
  /** Total SPF DNS lookups (changes when an included record changes). */
  spfLookups: number | null;
  /** True when any DNS lookup failed: such a snapshot must not be recorded. */
  incomplete?: boolean;
}

export interface DnsChangeLine {
  kind: 'dmarc' | 'spf' | 'dkim';
  summary: string;
}

interface ReportLike {
  dmarc: { record: string | null; lookupFailed?: boolean };
  spf: {
    record: string | null;
    lookupFailed?: boolean;
    lookups?: { total: number; truncated: boolean };
  };
  dkim: Array<{
    selector: string;
    present: boolean;
    lookupFailed?: boolean;
    bits?: number;
    fingerprint?: string;
  }>;
}

export function snapshotOf(report: ReportLike): DnsSnapshot {
  const incomplete =
    !!report.dmarc.lookupFailed ||
    !!report.spf.lookupFailed ||
    report.dkim.some((d) => d.lookupFailed) ||
    !!report.spf.lookups?.truncated;
  return {
    dmarc: report.dmarc.record,
    spf: report.spf.record,
    dkim: Object.fromEntries(
      report.dkim.map((d) => [
        d.selector,
        {
          present: d.present,
          bits: d.bits ?? null,
          fingerprint: d.fingerprint ?? null,
        },
      ]),
    ),
    spfLookups: report.spf.lookups?.total ?? null,
    ...(incomplete ? { incomplete: true } : {}),
  };
}

function diffDmarc(prev: string | null, next: string | null): string[] {
  if (prev === next) {
    return [];
  }
  if (prev === null) {
    return [`DMARC record added: ${next}`];
  }
  if (next === null) {
    return ['DMARC record removed'];
  }
  const a = parseTags(prev);
  const b = parseTags(next);
  const out: string[] = [];
  for (const tag of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (a[tag] === b[tag]) {
      continue;
    }
    if (a[tag] === undefined) {
      out.push(`DMARC: ${tag}=${b[tag]} added`);
    } else if (b[tag] === undefined) {
      out.push(`DMARC: ${tag}=${a[tag]} removed`);
    } else {
      out.push(`DMARC: ${tag} changed from ${a[tag]} to ${b[tag]}`);
    }
  }
  return out;
}

function diffSpf(prev: string | null, next: string | null): string[] {
  if (prev === next) {
    return [];
  }
  if (prev === null) {
    return [`SPF record added: ${next}`];
  }
  if (next === null) {
    return ['SPF record removed'];
  }
  const a = new Set(splitSpfTerms(prev));
  const b = new Set(splitSpfTerms(next));
  const added = [...b].filter((t) => !a.has(t));
  const removed = [...a].filter((t) => !b.has(t));
  const out: string[] = [];
  if (added.length > 0) {
    out.push(`SPF: added ${added.join(', ')}`);
  }
  if (removed.length > 0) {
    out.push(`SPF: removed ${removed.join(', ')}`);
  }
  return out.length > 0 ? out : ['SPF record changed'];
}

export function diffSnapshots(
  prev: DnsSnapshot,
  next: DnsSnapshot,
): DnsChangeLine[] {
  const changes: DnsChangeLine[] = [];

  for (const summary of diffDmarc(prev.dmarc, next.dmarc)) {
    changes.push({ kind: 'dmarc', summary });
  }
  for (const summary of diffSpf(prev.spf, next.spf)) {
    changes.push({ kind: 'spf', summary });
  }
  // The record text is the same but an included record changed underneath it.
  if (
    prev.spf === next.spf &&
    prev.spfLookups !== null &&
    next.spfLookups !== null &&
    prev.spfLookups !== next.spfLookups
  ) {
    changes.push({
      kind: 'spf',
      summary: `SPF lookup count changed from ${prev.spfLookups} to ${next.spfLookups} (an included record changed)`,
    });
  }

  for (const selector of new Set([
    ...Object.keys(prev.dkim),
    ...Object.keys(next.dkim),
  ])) {
    const a = prev.dkim[selector];
    const b = next.dkim[selector];
    if (!a) {
      changes.push({
        kind: 'dkim',
        summary: `DKIM selector ${selector} appeared`,
      });
    } else if (!b) {
      changes.push({
        kind: 'dkim',
        summary: `DKIM selector ${selector} is no longer checked`,
      });
    } else if (a.present !== b.present) {
      changes.push({
        kind: 'dkim',
        summary: `DKIM key for selector ${selector} ${b.present ? 'published' : 'removed or revoked'}`,
      });
    } else if (a.fingerprint !== b.fingerprint) {
      const size =
        a.bits !== b.bits && b.bits !== null
          ? ` (${a.bits ?? '?'} -> ${b.bits} bit)`
          : '';
      changes.push({
        kind: 'dkim',
        summary: `DKIM key for selector ${selector} changed (rotated)${size}`,
      });
    }
  }
  return changes;
}
