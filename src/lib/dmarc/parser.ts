import { XMLParser } from 'fast-xml-parser';
import type {
  DKIMAuthResult,
  DMARCAnalysis,
  DMARCRecord,
  DMARCReport,
  PolicyOverrideReason,
  SPFAuthResult,
} from '@/types/dmarc';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  // Keep every value as text so long numeric-looking IDs are not rounded;
  // numbers are converted explicitly below.
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => {
    // These elements can appear multiple times
    return ['record', 'dkim', 'spf', 'error', 'reason'].includes(name);
  },
});

/**
 * Parse DMARC XML string into a typed DMARCReport object
 */
export function parseDMARCXML(xml: string): DMARCReport {
  const parsed = parser.parse(xml);

  if (!parsed.feedback) {
    throw new Error('Invalid DMARC XML: missing feedback element');
  }

  const feedback = parsed.feedback;

  // Normalize records to always be an array
  const records = normalizeToArray(feedback.record);

  const meta = feedback.report_metadata ?? {};
  const pp = feedback.policy_published ?? {};
  const version = textOf(feedback.version);

  const report: DMARCReport = {
    ...(version ? { version } : {}),
    report_metadata: {
      org_name: textOf(meta.org_name) ?? '',
      email: textOf(meta.email) ?? '',
      extra_contact_info: textOf(meta.extra_contact_info),
      report_id: String(textOf(meta.report_id) ?? ''),
      date_range: {
        begin: Number(meta.date_range?.begin),
        end: Number(meta.date_range?.end),
      },
      error: normalizeToArray(meta.error)
        .map((e) => textOf(e))
        .filter((e): e is string => !!e),
      generator: textOf(meta.generator),
    },
    policy_published: {
      domain: textOf(pp.domain) ?? '',
      p: normalizeDisposition(pp.p),
      adkim: alignment(pp.adkim),
      aspf: alignment(pp.aspf),
      sp: optionalDisposition(pp.sp),
      np: optionalDisposition(pp.np),
      pct: optionalNumber(pp.pct),
      testing: testing(pp.testing),
      discovery_method: discoveryMethod(pp.discovery_method),
      fo: textOf(pp.fo),
    },
    record: records.map(parseRecord),
  };

  return report;
}

/** Text of an element that may carry attributes (e.g. `<error lang="en">`). */
function textOf(node: unknown): string | undefined {
  if (node === undefined || node === null) {
    return undefined;
  }
  const raw =
    typeof node === 'object'
      ? (node as Record<string, unknown>)['#text']
      : node;
  const text = raw === undefined || raw === null ? '' : String(raw).trim();
  return text === '' ? undefined : text;
}

function optionalNumber(value: unknown): number | undefined {
  const text = textOf(value);
  if (text === undefined) {
    return undefined;
  }
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

function optionalDisposition(
  value: unknown,
): 'none' | 'quarantine' | 'reject' | undefined {
  return textOf(value) === undefined ? undefined : normalizeDisposition(value);
}

function alignment(value: unknown): 'r' | 's' | undefined {
  const t = textOf(value)?.toLowerCase();
  return t === 'r' || t === 's' ? t : undefined;
}

function testing(value: unknown): 'y' | 'n' | undefined {
  const t = textOf(value)?.toLowerCase();
  return t === 'y' || t === 'n' ? t : undefined;
}

function discoveryMethod(value: unknown): 'psl' | 'treewalk' | undefined {
  const t = textOf(value)?.toLowerCase();
  return t === 'psl' || t === 'treewalk' ? t : undefined;
}

function parseRecord(record: unknown): DMARCRecord {
  const r = record as Record<string, unknown>;
  const row = r.row as Record<string, unknown>;
  const identifiers = (r.identifiers ?? {}) as Record<string, unknown>;
  const authResults = (r.auth_results ?? {}) as Record<string, unknown>;
  const policyEvaluated = row.policy_evaluated as
    | Record<string, unknown>
    | undefined;

  return {
    row: {
      source_ip: String(row.source_ip),
      count: Number(row.count),
      policy_evaluated: policyEvaluated
        ? {
            disposition: normalizeDisposition(policyEvaluated.disposition),
            dkim: normalizeDMARCResult(policyEvaluated.dkim),
            spf: normalizeDMARCResult(policyEvaluated.spf),
            reason: normalizeToArray(policyEvaluated.reason).map(
              (reason: unknown) => {
                const re = reason as Record<string, unknown>;
                return {
                  type: re.type,
                  comment: re.comment,
                } as PolicyOverrideReason;
              },
            ),
          }
        : undefined,
    },
    identifiers: {
      envelope_to: identifiers.envelope_to
        ? String(identifiers.envelope_to)
        : undefined,
      envelope_from: identifiers.envelope_from
        ? String(identifiers.envelope_from)
        : undefined,
      header_from: String(identifiers.header_from),
    },
    auth_results: {
      dkim: normalizeToArray(authResults.dkim).map((dkim: unknown) => {
        const d = dkim as Record<string, unknown>;
        return {
          domain: String(d.domain),
          selector: d.selector ? String(d.selector) : undefined,
          result: d.result,
          human_result: d.human_result ? String(d.human_result) : undefined,
        } as DKIMAuthResult;
      }),
      spf: normalizeToArray(authResults.spf).map((spf: unknown) => {
        const s = spf as Record<string, unknown>;
        const scope = String(s.scope ?? '').toLowerCase();
        return {
          domain: String(s.domain),
          scope: scope === 'mfrom' || scope === 'helo' ? scope : undefined,
          result: s.result,
        } as SPFAuthResult;
      }),
    },
  };
}

function normalizeToArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function normalizeDMARCResult(value: unknown): 'pass' | 'fail' {
  const str = String(value).toLowerCase().trim();
  return str === 'pass' ? 'pass' : 'fail';
}

function normalizeDisposition(
  value: unknown,
): 'none' | 'quarantine' | 'reject' {
  const str = String(value).toLowerCase().trim();
  if (str === 'quarantine') {
    return 'quarantine';
  }
  if (str === 'reject') {
    return 'reject';
  }
  return 'none';
}

/**
 * Analyze a DMARC report and generate summary statistics
 */
export function analyzeDMARCReport(report: DMARCReport): DMARCAnalysis {
  let totalMessages = 0;
  let passedDKIM = 0;
  let failedDKIM = 0;
  let passedSPF = 0;
  let failedSPF = 0;
  let passedBoth = 0;
  let failedBoth = 0;
  let dispositionNone = 0;
  let dispositionQuarantine = 0;
  let dispositionReject = 0;

  for (const record of report.record) {
    const count = record.row.count;
    totalMessages += count;

    const policyEval = record.row.policy_evaluated;
    if (policyEval) {
      // DKIM results
      if (policyEval.dkim === 'pass') {
        passedDKIM += count;
      } else {
        failedDKIM += count;
      }

      // SPF results
      if (policyEval.spf === 'pass') {
        passedSPF += count;
      } else {
        failedSPF += count;
      }

      // Combined results
      if (policyEval.dkim === 'pass' && policyEval.spf === 'pass') {
        passedBoth += count;
      } else if (policyEval.dkim === 'fail' && policyEval.spf === 'fail') {
        failedBoth += count;
      }

      // Disposition counts
      switch (policyEval.disposition) {
        case 'none':
          dispositionNone += count;
          break;
        case 'quarantine':
          dispositionQuarantine += count;
          break;
        case 'reject':
          dispositionReject += count;
          break;
      }
    }
  }

  return {
    report,
    summary: {
      totalMessages,
      passedDKIM,
      failedDKIM,
      passedSPF,
      failedSPF,
      passedBoth,
      failedBoth,
      dispositionNone,
      dispositionQuarantine,
      dispositionReject,
    },
    dateRange: {
      start: new Date(report.report_metadata.date_range.begin * 1000),
      end: new Date(report.report_metadata.date_range.end * 1000),
    },
  };
}

/**
 * Parse and analyze DMARC XML in one step
 */
export function parseAndAnalyze(xml: string): DMARCAnalysis {
  const report = parseDMARCXML(xml);
  return analyzeDMARCReport(report);
}
