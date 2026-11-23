import type { DomainChange } from './changes';
import type { Readiness } from './readiness';

/**
 * "Needs attention": a short, ranked to-do list for a domain. Pure.
 *
 *  - error: an approved sender fails authentication (its mail would be
 *    rejected under enforcement), or a DNS problem
 *  - warn: a failing sender nobody has reviewed yet, or a DNS warning
 *  - info: a new sender since the last review that is not yet reviewed
 */

export type AttentionSeverity = 'error' | 'warn' | 'info';

export interface AttentionItem {
  id: string;
  severity: AttentionSeverity;
  title: string;
  detail: string;
  /** The source this is about, to link to it */
  ip?: string;
}

const RANK: Record<AttentionSeverity, number> = { error: 0, warn: 1, info: 2 };
const MAX_NEW = 5;

export function sortAttention(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}

/** DNS findings that are worth acting on (merged readiness only). */
export function dnsAttention(readiness: Readiness): AttentionItem[] {
  return readiness.checks
    .filter(
      (c) =>
        c.id.startsWith('dns-') &&
        (c.severity === 'error' || c.severity === 'warn'),
    )
    .map((c) => ({
      id: `dns:${c.id}`,
      severity: c.severity as AttentionSeverity,
      title: c.title,
      detail: c.message,
    }));
}

export function buildAttention(
  readiness: Readiness,
  changes: DomainChange | null | undefined,
): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const s of readiness.sourcesToReview) {
    const pct = `${(s.share * 100).toFixed(1)}%`;
    const servers = s.ips.length > 1 ? ` (${s.ips.length} servers)` : '';
    if (s.review === 'approved') {
      items.push({
        id: `fail:${s.ip}`,
        severity: 'error',
        title: `${s.service ?? s.ip} is approved but fails authentication${servers}`,
        detail: `${s.failedBoth.toLocaleString('en-US')} of ${s.messages.toLocaleString('en-US')} messages failed both DKIM and SPF. Fix its SPF or DKIM so its mail survives enforcement.`,
        ip: s.ip,
      });
    } else {
      items.push({
        id: `fail:${s.ip}`,
        severity: 'warn',
        title: `Review ${s.service ?? s.ip}${servers}`,
        detail: `${s.failedBoth.toLocaleString('en-US')} messages failed both checks (${pct} of the domain's mail). If it is yours, approve it and fix its authentication; otherwise mark it as not yours.`,
        ip: s.ip,
      });
    }
  }

  const seen = new Set(readiness.sourcesToReview.flatMap((r) => r.ips));
  // New senders, grouped by service (a provider may use several IPs).
  const groups = new Map<
    string,
    { title: string; ip: string; ips: number; messages: number; status: string }
  >();
  for (const n of changes?.newSources ?? []) {
    if (n.review !== 'unreviewed' || seen.has(n.ip)) {
      continue;
    }
    const key = n.service ? `svc:${n.service}` : `ip:${n.ip}`;
    const g = groups.get(key) ?? {
      title: n.service ?? n.ip,
      ip: n.ip,
      ips: 0,
      messages: 0,
      status: n.status,
    };
    g.ips += 1;
    g.messages += n.messages;
    groups.set(key, g);
  }
  const fresh = [...groups.entries()];
  for (const [key, g] of fresh.slice(0, MAX_NEW)) {
    items.push({
      id: `new:${key}`,
      severity: 'info',
      title: `New sender ${g.title}${g.ips > 1 ? ` (${g.ips} servers)` : ''}`,
      detail: `First seen after your last review: ${g.messages.toLocaleString('en-US')} messages${g.ips > 1 ? '' : ` (${g.status})`}. Is it yours?`,
      ip: g.ip,
    });
  }
  if (fresh.length > MAX_NEW) {
    items.push({
      id: 'new:more',
      severity: 'info',
      title: `${fresh.length - MAX_NEW} more new senders`,
      detail: 'Open the sources table below to review them.',
    });
  }

  return sortAttention(items);
}
