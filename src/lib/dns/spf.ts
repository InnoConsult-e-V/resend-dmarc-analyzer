import 'server-only';
import { Resolver } from 'node:dns/promises';
import type { Finding, TxtResolver } from './records';

/**
 * SPF DNS-lookup counter. RFC 7208 allows at most 10 DNS-querying terms
 * (include, a, mx, ptr, exists, redirect) while evaluating a record, counting
 * nested includes, and at most 2 "void" lookups (queries that return nothing).
 * Going over makes SPF fail with a PermError, and nothing warns you except
 * DMARC failures in reports.
 *
 * The walk is capped (depth, number of queries, time) so a hostile or broken
 * record cannot make it run away. The resolver is injectable for tests.
 */

export const SPF_LOOKUP_LIMIT = 10;
export const SPF_VOID_LIMIT = 2;
const WARN_AT = 8;
const MAX_DEPTH = 10;
const MAX_QUERIES = 40;
const TIME_BUDGET_MS = 6000;

export interface SpfResolver extends TxtResolver {
  resolveMx?(name: string): Promise<Array<{ exchange: string }>>;
  resolve4?(name: string): Promise<string[]>;
  resolve6?(name: string): Promise<string[]>;
}

export interface SpfNode {
  /** The term as written, e.g. `include:_spf.google.com` */
  term: string;
  /** Domain the term points at, when it has one */
  domain?: string;
  children: SpfNode[];
  note?: string;
}

export interface SpfAnalysis {
  total: number;
  voids: number;
  tree: SpfNode[];
  /** True if a cap stopped the walk early, so the counts may be too low. */
  truncated: boolean;
  findings: Finding[];
}

export function defaultSpfResolver(): SpfResolver {
  return new Resolver({ timeout: 3000, tries: 2 });
}

const NO_DATA = new Set(['ENODATA', 'ENOTFOUND', 'NXDOMAIN']);

function isNoData(err: unknown): boolean {
  return NO_DATA.has((err as { code?: string }).code ?? '');
}

interface State {
  lookups: number;
  voids: number;
  queries: number;
  visited: Set<string>;
  truncated: boolean;
  loop: boolean;
  usesPtr: boolean;
  badIncludes: string[];
  deadline: number;
}

/** Run one DNS query. Returns null when the answer is empty (a void lookup). */
async function query<T>(
  st: State,
  fn: (() => Promise<T[]>) | undefined,
): Promise<'unsupported' | 'empty' | 'ok' | 'failed'> {
  if (!fn) {
    return 'unsupported';
  }
  if (st.queries >= MAX_QUERIES || Date.now() > st.deadline) {
    st.truncated = true;
    return 'failed';
  }
  st.queries++;
  try {
    const res = await fn();
    return res.length > 0 ? 'ok' : 'empty';
  } catch (err) {
    return isNoData(err) ? 'empty' : 'failed';
  }
}

async function spfRecordOf(
  st: State,
  resolver: SpfResolver,
  domain: string,
): Promise<{ record: string | null; multiple: boolean; empty: boolean }> {
  if (st.queries >= MAX_QUERIES || Date.now() > st.deadline) {
    st.truncated = true;
    return { record: null, multiple: false, empty: false };
  }
  st.queries++;
  try {
    const rows = (await resolver.resolveTxt(domain)).map((c) => c.join(''));
    const spf = rows.filter((r) => /^\s*v=spf1\b/i.test(r));
    return {
      record: spf[0] ?? null,
      multiple: spf.length > 1,
      empty: spf.length === 0,
    };
  } catch (err) {
    return { record: null, multiple: false, empty: isNoData(err) };
  }
}

async function walk(
  st: State,
  resolver: SpfResolver,
  record: string,
  depth: number,
): Promise<SpfNode[]> {
  const nodes: SpfNode[] = [];
  const terms = record.trim().split(/\s+/).slice(1);

  for (const raw of terms) {
    const term = raw.replace(/^[+\-~?]/, '');
    const lower = term.toLowerCase();
    const [, name, arg] =
      lower.match(/^([a-z0-9]+)(?:[:=](.*?))?(?:\/.*)?$/) ?? [];
    const target = (arg ?? '').split('/')[0];

    if (name === 'include' || name === 'redirect') {
      if (!target) {
        continue;
      }
      st.lookups++;
      const node: SpfNode = { term: raw, domain: target, children: [] };
      nodes.push(node);
      if (st.visited.has(target)) {
        st.loop = true;
        node.note = 'loop: already visited';
        continue;
      }
      if (depth >= MAX_DEPTH) {
        st.truncated = true;
        node.note = 'depth limit reached';
        continue;
      }
      st.visited.add(target);
      const inc = await spfRecordOf(st, resolver, target);
      if (inc.multiple) {
        node.note = 'multiple SPF records';
        st.badIncludes.push(target);
      }
      if (inc.record) {
        node.children = await walk(st, resolver, inc.record, depth + 1);
      } else if (inc.empty) {
        // RFC 7208: including a domain without an SPF record is a PermError.
        st.voids++;
        st.badIncludes.push(target);
        node.note = 'no SPF record found';
      }
    } else if (name === 'a' || name === 'mx' || name === 'exists') {
      st.lookups++;
      const domain = target || '(this domain)';
      nodes.push({ term: raw, domain: target || undefined, children: [] });
      if (target) {
        let result: Awaited<ReturnType<typeof query>>;
        if (name === 'mx') {
          result = await query(st, resolver.resolveMx?.bind(resolver, target));
        } else {
          const v4 = await query(st, resolver.resolve4?.bind(resolver, target));
          result =
            name === 'a' && v4 === 'empty'
              ? await query(st, resolver.resolve6?.bind(resolver, target))
              : v4;
        }
        if (result === 'empty') {
          st.voids++;
          nodes[nodes.length - 1].note =
            `void lookup (${domain} returned nothing)`;
        }
      }
    } else if (name === 'ptr') {
      st.lookups++;
      st.usesPtr = true;
      nodes.push({
        term: raw,
        children: [],
        note: 'ptr is deprecated and slow',
      });
    }
    // ip4, ip6, all and unknown terms need no DNS lookup.
  }
  return nodes;
}

export async function analyzeSpf(
  domain: string,
  record: string,
  resolver: SpfResolver = defaultSpfResolver(),
): Promise<SpfAnalysis> {
  const st: State = {
    lookups: 0,
    voids: 0,
    queries: 0,
    visited: new Set([domain.toLowerCase()]),
    truncated: false,
    loop: false,
    usesPtr: false,
    badIncludes: [],
    deadline: Date.now() + TIME_BUDGET_MS,
  };
  const tree = await walk(st, resolver, record, 0);

  const findings: Finding[] = [];
  if (st.lookups > SPF_LOOKUP_LIMIT) {
    findings.push({
      severity: 'error',
      message: `SPF needs ${st.lookups} DNS lookups, over the limit of ${SPF_LOOKUP_LIMIT}: receivers return a PermError and SPF fails for every message.`,
    });
  } else if (st.lookups >= WARN_AT) {
    findings.push({
      severity: 'warn',
      message: `SPF uses ${st.lookups} of ${SPF_LOOKUP_LIMIT} allowed DNS lookups. An included provider adding one more would break SPF.`,
    });
  } else {
    findings.push({
      severity: 'ok',
      message: `SPF uses ${st.lookups} of ${SPF_LOOKUP_LIMIT} allowed DNS lookups.`,
    });
  }
  if (st.voids > SPF_VOID_LIMIT) {
    findings.push({
      severity: 'error',
      message: `SPF has ${st.voids} void lookups (limit ${SPF_VOID_LIMIT}): remove includes or mechanisms that point at nothing.`,
    });
  }
  for (const d of st.badIncludes) {
    findings.push({
      severity: 'error',
      message: `include target ${d} has no valid SPF record (PermError).`,
    });
  }
  if (st.loop) {
    findings.push({
      severity: 'error',
      message: 'SPF includes form a loop (PermError).',
    });
  }
  if (st.usesPtr) {
    findings.push({
      severity: 'warn',
      message:
        'The ptr mechanism is deprecated; replace it with ip4/ip6 or include.',
    });
  }
  if (st.truncated) {
    findings.push({
      severity: 'warn',
      message:
        'The check stopped early (query or time limit): the lookup count may be too low.',
    });
  }

  return {
    total: st.lookups,
    voids: st.voids,
    tree,
    truncated: st.truncated,
    findings,
  };
}
