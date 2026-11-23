import 'server-only';
import { createHash, createPublicKey } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import type { PublishedPolicy } from '@/lib/dmarc/policy';
import { parseTags } from './record-text';
import { analyzeSpf, type SpfAnalysis, type SpfResolver } from './spf';

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
  /** True when the DNS lookup itself failed (so `record` is unknown). */
  lookupFailed?: boolean;
  record: string | null;
  tags: Record<string, string>;
  rua: string[];
  findings: Finding[];
}

export interface SpfCheck {
  lookupFailed?: boolean;
  record: string | null;
  /** DNS-lookup count and include tree (only when a record exists). */
  lookups?: SpfAnalysis;
  findings: Finding[];
}

export interface DkimCheck {
  selector: string;
  present: boolean;
  lookupFailed?: boolean;
  keyType?: 'rsa' | 'ed25519' | 'other';
  /** RSA modulus size in bits (256 for ed25519) */
  bits?: number;
  /** Short hash of the published key, to notice rotation. */
  fingerprint?: string;
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
  published?: PublishedPolicy | null;
  resolver?: TxtResolver;
}

const RANK: Record<Severity, number> = { ok: 0, info: 1, warn: 2, error: 3 };

export function worst(findings: Finding[]): Severity {
  return findings.reduce<Severity>(
    (acc, f) => (RANK[f.severity] > RANK[acc] ? f.severity : acc),
    'ok',
  );
}

export { parseTags };

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
    return { lookupFailed: true, record: null, tags: {}, rua: [], findings };
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

  // DMARCbis (RFC 9989) replaced pct with t and removed rf/ri.
  const testing = (tags.t ?? '').toLowerCase();
  if (tags.t !== undefined) {
    if (testing === 'y') {
      findings.push({
        severity: 'info',
        message:
          't=y: testing mode. Receivers that implement DMARCbis do not apply the policy (like pct=0).',
      });
    } else if (testing !== 'n') {
      findings.push({
        severity: 'warn',
        message: `t=${tags.t} is not a valid value (use y or n)`,
      });
    }
  }
  if (tags.pct !== undefined) {
    const n = Number(tags.pct);
    findings.push(
      n < 100
        ? {
            severity: 'warn',
            message: `pct=${tags.pct}: older receivers apply the policy to only ${tags.pct}% of failing mail, but pct is removed in DMARCbis, so newer receivers ignore it and apply the policy to all failing mail. Use t=y to test instead.`,
          }
        : {
            severity: 'info',
            message:
              'pct=100 is redundant: pct is removed in DMARCbis and 100 is the default.',
          },
    );
  }
  if (tags.rf !== undefined || tags.ri !== undefined) {
    findings.push({
      severity: 'info',
      message:
        'rf= and ri= are removed in DMARCbis and ignored by new receivers.',
    });
  }
  if (policy !== 'none' && policy !== '' && tags.np === undefined) {
    findings.push({
      severity: 'info',
      message:
        'No np= tag: consider np=reject to block mail from subdomains that do not exist (DMARCbis).',
    });
  }
  if (tags.psd !== undefined) {
    findings.push({
      severity: 'info',
      message: `psd=${tags.psd} (declares whether this is a public suffix domain)`,
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
    return { lookupFailed: true, record: null, findings };
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
      lookupFailed: true,
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

  const tags = parseTags(key);
  const p = (tags.p ?? '').replace(/\s+/g, '');
  const keyType = (tags.k ?? 'rsa').toLowerCase();
  const fingerprint = createHash('sha256').update(p).digest('hex').slice(0, 16);
  const findings: Finding[] = [];
  let bits: number | undefined;
  let type: DkimCheck['keyType'] = 'other';

  if (keyType === 'ed25519') {
    type = 'ed25519';
    bits = 256;
    findings.push({ severity: 'ok', message: 'Ed25519 key published' });
  } else {
    type = keyType === 'rsa' ? 'rsa' : 'other';
    try {
      bits = createPublicKey({
        key: Buffer.from(p, 'base64'),
        format: 'der',
        type: 'spki',
      }).asymmetricKeyDetails?.modulusLength;
    } catch {
      bits = undefined;
    }
    if (bits === undefined) {
      findings.push({
        severity: 'warn',
        message: 'DKIM key is published but its public key could not be read',
      });
    } else if (bits < 1024) {
      findings.push({
        severity: 'error',
        message: `RSA ${bits}-bit key is too weak: publish a 2048-bit key`,
      });
    } else if (bits === 1024) {
      findings.push({
        severity: 'warn',
        message: 'RSA 1024-bit key: upgrade to 2048-bit when you can rotate',
      });
    } else if (bits >= 2048) {
      findings.push({
        severity: 'ok',
        message: `RSA ${bits}-bit key published`,
      });
    } else {
      findings.push({
        severity: 'info',
        message: `RSA ${bits}-bit key published`,
      });
    }
  }
  if ((tags.t ?? '').toLowerCase().split(':').includes('y')) {
    findings.push({
      severity: 'info',
      message:
        'Key is marked t=y (testing): receivers may ignore DKIM failures.',
    });
  }

  return {
    selector,
    present: true,
    keyType: type,
    bits,
    fingerprint,
    findings,
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
  if (spf.record) {
    const lookups = await analyzeSpf(
      domain,
      spf.record,
      resolver as SpfResolver,
    );
    spf.lookups = lookups;
    spf.findings.push(...lookups.findings);
  }
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
