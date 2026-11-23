/**
 * DMARC Report Types (RUA - Aggregate Reports)
 * Based on the DMARC XML Schema: http://dmarc.org/dmarc-xml/0.1
 */

// Alignment mode (relaxed or strict) for DKIM and SPF
export type AlignmentType = 'r' | 's';

// Policy actions specified by p and sp in the DMARC record
export type DispositionType = 'none' | 'quarantine' | 'reject';

// DMARC-aligned authentication result
export type DMARCResultType = 'pass' | 'fail';

// DKIM verification result (RFC 5451 Section 2.4.1)
export type DKIMResultType =
  | 'none'
  | 'pass'
  | 'fail'
  | 'policy'
  | 'neutral'
  | 'temperror'
  | 'permerror';

// SPF verification result
export type SPFResultType =
  | 'none'
  | 'neutral'
  | 'pass'
  | 'fail'
  | 'softfail'
  | 'temperror'
  | 'permerror';

// Reasons that may affect DMARC disposition
export type PolicyOverrideType =
  | 'forwarded'
  | 'sampled_out'
  | 'trusted_forwarder'
  | 'mailing_list'
  | 'local_policy'
  | 'other';

// Time range in UTC covered by messages, specified in seconds since epoch
export interface DateRange {
  begin: number;
  end: number;
}

// Report generator metadata
export interface ReportMetadata {
  org_name: string;
  email: string;
  extra_contact_info?: string;
  report_id: string;
  date_range: DateRange;
  error?: string[];
  /** RFC 9990: software that generated the report. */
  generator?: string;
}

// DMARC policy that applied to messages in this report
export interface PolicyPublished {
  domain: string;
  p: DispositionType;
  // Optional: RFC 9990 (DMARCbis) reports omit these when not published.
  adkim?: AlignmentType;
  aspf?: AlignmentType;
  sp?: DispositionType;
  /** Policy for non-existent subdomains (DMARCbis). */
  np?: DispositionType;
  /** Removed in DMARCbis; absent means 100. */
  pct?: number;
  /** DMARCbis `t` tag: `y` means the policy is not applied (test mode). */
  testing?: 'y' | 'n';
  discovery_method?: 'psl' | 'treewalk';
  fo?: string;
}

// Policy override reason
export interface PolicyOverrideReason {
  type: PolicyOverrideType;
  comment?: string;
}

// Results of applying DMARC policy
export interface PolicyEvaluated {
  disposition: DispositionType;
  dkim: DMARCResultType;
  spf: DMARCResultType;
  reason?: PolicyOverrideReason[];
}

// Row data for a record
export interface Row {
  source_ip: string;
  count: number;
  policy_evaluated?: PolicyEvaluated;
}

// Identifier information
export interface Identifiers {
  envelope_to?: string;
  /** MAIL FROM (bounce) domain: the identity SPF is checked against. */
  envelope_from?: string;
  header_from: string;
}

// DKIM authentication result
export interface DKIMAuthResult {
  domain: string;
  selector?: string;
  result: DKIMResultType;
  human_result?: string;
}

// SPF authentication result
export interface SPFAuthResult {
  domain: string;
  /** Which identity SPF checked: the MAIL FROM or the HELO/EHLO name. */
  scope?: 'mfrom' | 'helo';
  result: SPFResultType;
}

// Authentication results (DKIM and SPF)
export interface AuthResults {
  dkim?: DKIMAuthResult[];
  spf: SPFAuthResult[];
}

// Individual record in the report
export interface DMARCRecord {
  row: Row;
  identifiers: Identifiers;
  auth_results: AuthResults;
}

// Complete DMARC Feedback Report (RUA)
export interface DMARCReport {
  /** RFC 9990 `version` element (1.0) when present. */
  version?: string;
  report_metadata: ReportMetadata;
  policy_published: PolicyPublished;
  record: DMARCRecord[];
}

// Parsed report with analysis
export interface DMARCAnalysis {
  report: DMARCReport;
  summary: {
    totalMessages: number;
    passedDKIM: number;
    failedDKIM: number;
    passedSPF: number;
    failedSPF: number;
    passedBoth: number;
    failedBoth: number;
    dispositionNone: number;
    dispositionQuarantine: number;
    dispositionReject: number;
  };
  dateRange: {
    start: Date;
    end: Date;
  };
}

// RUF (Forensic) Report - passed through as raw content for now
export interface RUFReport {
  raw: string;
  receivedAt: Date;
  from?: string;
  subject?: string;
}
