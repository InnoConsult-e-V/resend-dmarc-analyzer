'use client';

import type { DomainDnsReport, Finding, Severity } from '@/lib/dns/records';
import { StatusChip, type Tone } from './status-chip';

// Type-only import above: the DNS module itself is server-only.

const SEVERITY_TONE: Record<Severity, Tone> = {
  ok: 'good',
  info: 'neutral',
  warn: 'warn',
  error: 'bad',
};

const SEVERITY_LABEL: Record<Severity, string> = {
  ok: 'OK',
  info: 'Info',
  warn: 'Warning',
  error: 'Problem',
};

export type DnsResult = DomainDnsReport & { reportAddressConfigured: boolean };

export function DnsChip({ severity }: { severity: Severity }) {
  return (
    <StatusChip
      tone={SEVERITY_TONE[severity]}
      label={`DNS: ${SEVERITY_LABEL[severity]}`}
    />
  );
}

function Findings({
  title,
  record,
  findings,
}: {
  title: string;
  record: string | null;
  findings: Finding[];
}) {
  return (
    <div>
      <h4 className="mb-1 text-sm font-medium text-gray-10">{title}</h4>
      {record && (
        <code className="mb-2 block break-all rounded bg-gray-1 px-2 py-1 text-xs text-gray-7">
          {record}
        </code>
      )}
      <ul className="space-y-1">
        {findings.map((f) => (
          <li
            key={`${f.severity}:${f.message}`}
            className="flex items-start gap-2 text-sm text-gray-8"
          >
            <span className="mt-0.5 shrink-0">
              <StatusChip
                tone={SEVERITY_TONE[f.severity]}
                label={SEVERITY_LABEL[f.severity]}
              />
            </span>
            <span>{f.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DnsPanel({ result }: { result: DnsResult }) {
  return (
    <div className="grid gap-5 border-t border-gray-3 bg-gray-1 px-4 py-4 md:grid-cols-3">
      <Findings
        title="DMARC"
        record={result.dmarc.record}
        findings={result.dmarc.findings}
      />
      <Findings
        title="SPF"
        record={result.spf.record}
        findings={result.spf.findings}
      />
      <div>
        <h4 className="mb-1 text-sm font-medium text-gray-10">
          DKIM selectors seen in reports
        </h4>
        {result.dkim.length === 0 ? (
          <p className="text-sm text-gray-6">
            No DKIM selectors for this domain in the cached reports.
          </p>
        ) : (
          <ul className="space-y-2">
            {result.dkim.map((d) => (
              <li key={d.selector} className="text-sm text-gray-8">
                <code className="text-xs text-gray-9">{d.selector}</code>
                <ul className="mt-1 space-y-1">
                  {d.findings.map((f) => (
                    <li key={f.message} className="flex items-center gap-2">
                      <StatusChip
                        tone={SEVERITY_TONE[f.severity]}
                        label={SEVERITY_LABEL[f.severity]}
                      />
                      {f.message}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {!result.reportAddressConfigured && (
          <p className="mt-4 text-xs text-gray-6">
            Set DMARC_REPORT_ADDRESS to also check that rua= points at your
            mailbox.
          </p>
        )}
      </div>
    </div>
  );
}
