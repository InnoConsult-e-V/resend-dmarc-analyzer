import 'server-only';
import { Resolver } from 'node:dns/promises';
import type { DispositionType } from '@/types/dmarc';

/**
 * DNS health check for a domain's DMARC, SPF and DKIM records. The resolver is
 * injectable so the parsing/judging logic can be tested without the network.
 */

export interface TxtResolver {
  resolveTxt(name: string): Promise<string[][]>;
}

export type Severity = 'ok' | 'info' | 'warn' | 'error';

export interface Finding {
  severity: Severity;
  message: string;
}

export interface DmarcCheck {
  record: string | null;
  tags: Record<string, string>;
  rua: string[];
  findings: Finding[];
}

export interface SpfCheck {
  record: string | null;
  findings: Finding[];
}

export interface DkimCheck {
  selector: string;
  present: boolean;
  findings: Finding[];
}

export interface DomainDnsReport {
  domain: string;
  checkedAt: string;
  dmarc: DmarcCheck;
  spf: SpfCheck;
  dkim: DkimCheck[];
  overall: Severity;
}

export interface DnsCheckContext {
  selectors: string[];
  /** Address that should appear in rua= (DMARC_REPORT_ADDRESS), if known. */
  reportAddress?: string;
  /** Policy from the most recent report, to detect record changes. */
  published?: { p: DispositionType; sp: DispositionType; pct: number } | null;
  resolver?: TxtResolver;
}

const RANK: Record<Severity, number> = { ok: 0, info: 1, warn: 2, error: 3 };

export function worst(findings: Finding[]): Severity {
  return findings.reduce<Severity>(
    (acc, f) => (RANK[f.severity] > RANK[acc] ? f.severity : acc),
    'ok',
  );
}

export function defaultResolver(): TxtResolver {
  return new Resolver({ timeout: 3000, tries: 2 });
}

/** "No such record" is a normal answer, anything else is a lookup failure. */
const NO_RECORD_CODES = new Set(['ENODATA', 'ENOTFOUND', 'NXDOMAIN']);

async function txt(
  resolver: TxtResolver,
  name: string,
): Promise<{ records: string[]; failed: boolean }> {
  try {
    const rows = await resolver.resolveTxt(name);
    return { records: rows.map((chunks) => chunks.join('')), failed: false };
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    return { records: [], failed: !NO_RECORD_CODES.has(code) };
  }
}

export function parseTags(record: string): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const part of record.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      tags[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
    }
  }
  return tags;
}

export function ruaAddresses(rua: string | undefined): string[] {
  if (!rua) {
    return [];
  }
  return rua
    .split(',')
    .map((a) =>
      a
        .trim()
        .replace(/^mailto:/i, '')
        .split('!')[0]
        .toLowerCase(),
    )
    .filter(Boolean);
}

export function judgeDmarc(
  domain: string,
  records: string[],
  ctx: Pick<DnsCheckContext, 'reportAddress' | 'published'>,
  lookupFailed = false,
): DmarcCheck {
  const findings: Finding[] = [];
  const dmarc = records.filter((r) => /^\s*v=DMARC1\b/i.test(r));

  if (lookupFailed) {
    findings.push({
      severity: 'warn',
      message: `Could not look up _dmarc.${domain} (DNS error or timeout)`,
    });
    return { record: null, tags: {}, rua: [], findings };
  }
  if (dmarc.length === 0) {
    findings.push({
      severity: 'error',
      message: `No DMARC record found at _dmarc.${domain}`,
    });
    return { record: null, tags: {}, rua: [], findings };
  }
  if (dmarc.length > 1) {
    findings.push({
      severity: 'error',
      message: 'Multiple DMARC records found; receivers will ignore them all',
    });
  }

  const record = dmarc[0];
  const tags = parseTags(record);
  const rua = ruaAddresses(tags.rua);

  const policy = (tags.p ?? '').toLowerCase();
  if (policy === 'none') {
    findings.push({
      severity: 'info',
      message: 'Policy is p=none (monitoring only, nothing is blocked)',
    });
  } else if (policy === 'quarantine' || policy === 'reject') {
    findings.push({ severity: 'ok', message: `Policy is p=${policy}` });
  } else {
    findings.push({ severity: 'error', message: 'Missing or invalid p= tag' });
  }

  if (tags.pct !== undefined && Number(tags.pct) < 100) {
    findings.push({
      severity: 'warn',
      message: `pct=${tags.pct}: the policy only applies to part of your mail`,
    });
  }

  if (rua.length === 0) {
    findings.push({
      severity: 'warn',
      message: 'No rua= address: aggregate reports will not be delivered',
    });
  } else if (ctx.reportAddress) {
    findings.push(
      rua.includes(ctx.reportAddress)
        ? { severity: 'ok', message: `rua= includes ${ctx.reportAddress}` }
        : {
            severity: 'error',
            message: `rua= does not include ${ctx.reportAddress} (found: ${rua.join(', ')})`,
          },
    );
  }

  if (ctx.published && policy && ctx.published.p !== policy) {
    findings.push({
      severity: 'info',
      message: `Live policy p=${policy} differs from p=${ctx.published.p} in the latest report`,
    });
  }

  return { record, tags, rua, findings };
}

export function judgeSpf(
  domain: string,
  records: string[],
  lookupFailed = false,
): SpfCheck {
  const findings: Finding[] = [];
  const spf = records.filter((r) => /^\s*v=spf1\b/i.test(r));

  if (lookupFailed) {
    findings.push({
      severity: 'warn',
      message: `Could not look up TXT records for ${domain} (DNS error or timeout)`,
    });
    return { record: null, findings };
  }
  if (spf.length === 0) {
    findings.push({ severity: 'warn', message: 'No SPF record found' });
    return { record: null, findings };
  }
  if (spf.length > 1) {
    findings.push({
      severity: 'error',
      message: 'Multiple SPF records found (SPF evaluation fails)',
    });
  }

  const record = spf[0];
  const all = record.match(/(?:^|\s)([+\-~?]?)all(?:\s|$)/i);
  if (!all) {
    findings.push({
      severity: /redirect=/i.test(record) ? 'ok' : 'warn',
      message: /redirect=/i.test(record)
        ? 'SPF delegates to another record with redirect='
        : 'SPF record has no "all" mechanism',
    });
  } else if (all[1] === '-') {
    findings.push({ severity: 'ok', message: 'SPF ends with -all (strict)' });
  } else if (all[1] === '~') {
    findings.push({
      severity: 'warn',
      message: 'SPF ends with ~all (soft fail); consider -all once stable',
    });
  } else {
    findings.push({
      severity: 'error',
      message: `SPF ends with ${all[1] || '+'}all, which allows anyone to send as this domain`,
    });
  }
  return { record, findings };
}

export function judgeDkim(
  selector: string,
  records: string[],
  lookupFailed = false,
): DkimCheck {
  if (lookupFailed) {
    return {
      selector,
      present: false,
      findings: [
        { severity: 'warn', message: 'Lookup failed (DNS error or timeout)' },
      ],
    };
  }
  const key = records.find((r) => /\bp=/i.test(r) || /v=DKIM1/i.test(r));
  if (!key) {
    return {
      selector,
      present: false,
      findings: [{ severity: 'warn', message: 'No DKIM key published' }],
    };
  }
  if (/\bp=\s*(;|$)/i.test(key)) {
    return {
      selector,
      present: false,
      findings: [
        { severity: 'warn', message: 'DKIM key is revoked (empty p=)' },
      ],
    };
  }
  return {
    selector,
    present: true,
    findings: [{ severity: 'ok', message: 'DKIM key published' }],
  };
}

export async function checkDomainDns(
  domain: string,
  ctx: DnsCheckContext,
): Promise<DomainDnsReport> {
  const resolver = ctx.resolver ?? defaultResolver();

  const [dmarcTxt, spfTxt, dkimTxt] = await Promise.all([
    txt(resolver, `_dmarc.${domain}`),
    txt(resolver, domain),
    Promise.all(
      ctx.selectors.map(async (s) => ({
        selector: s,
        res: await txt(resolver, `${s}._domainkey.${domain}`),
      })),
    ),
  ]);

  const dmarc = judgeDmarc(domain, dmarcTxt.records, ctx, dmarcTxt.failed);
  const spf = judgeSpf(domain, spfTxt.records, spfTxt.failed);
  const dkim = dkimTxt.map(({ selector, res }) =>
    judgeDkim(selector, res.records, res.failed),
  );

  return {
    domain,
    checkedAt: new Date().toISOString(),
    dmarc,
    spf,
    dkim,
    overall: worst([
      ...dmarc.findings,
      ...spf.findings,
      ...dkim.flatMap((d) => d.findings),
    ]),
  };
}
