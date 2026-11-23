'use client';

import type { DomainDnsReport, Finding, Severity } from '@/lib/dns/records';
import type { SpfNode } from '@/lib/dns/spf';
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

export type DnsResult = DomainDnsReport & {
  reportAddressConfigured: boolean;
  /** Recent DNS changes, newest first (from the DNS history). */
  history?: Array<{
    at: string;
    baseline: boolean;
    changes: Array<{ kind: string; summary: string }>;
  }>;
};

const SPF_LIMIT = 10;

function SpfTree({ nodes }: { nodes: SpfNode[] }) {
  if (nodes.length === 0) {
    return null;
  }
  return (
    <ul className="ml-3 space-y-0.5 border-l border-gray-3 pl-3">
      {nodes.map((n, i) => (
        <li key={`${n.term}:${i}`}>
          <span className="font-mono text-xs text-gray-8">{n.term}</span>
          {n.note && <span className="text-xs text-yellow"> ({n.note})</span>}
          <SpfTree nodes={n.children} />
        </li>
      ))}
    </ul>
  );
}

/** How much of the 10-lookup SPF budget is used, plus the include tree. */
function SpfMeter({
  lookups,
}: {
  lookups: NonNullable<DnsResult['spf']['lookups']>;
}) {
  const used = lookups.total;
  const tone: Tone = used > SPF_LIMIT ? 'bad' : used >= 8 ? 'warn' : 'good';
  const color =
    used > SPF_LIMIT ? 'bg-red' : used >= 8 ? 'bg-yellow' : 'bg-green';
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center justify-between gap-2 text-xs text-gray-7">
        <span>
          DNS lookups: {used} of {SPF_LIMIT}
          {lookups.voids > 0 && ` · ${lookups.voids} void`}
        </span>
        <StatusChip
          tone={tone}
          label={
            used > SPF_LIMIT
              ? 'Over limit'
              : used >= 8
                ? 'Close to limit'
                : 'Within limit'
          }
        />
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-gray-3"
        role="img"
        aria-label={`${used} of ${SPF_LIMIT} SPF DNS lookups used`}
      >
        <div
          className={`h-full ${color}`}
          style={{ width: `${Math.min(100, (used / SPF_LIMIT) * 100)}%` }}
        />
      </div>
      {lookups.tree.length > 0 && (
        <details className="mt-2 text-xs text-gray-7">
          <summary className="cursor-pointer select-none hover:text-gray-9">
            Show include tree
          </summary>
          <div className="mt-2">
            <SpfTree nodes={lookups.tree} />
          </div>
        </details>
      )}
    </div>
  );
}

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
      <div>
        <Findings
          title="SPF"
          record={result.spf.record}
          findings={result.spf.findings}
        />
        {result.spf.lookups && <SpfMeter lookups={result.spf.lookups} />}
      </div>
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
                {d.keyType && (
                  <span className="text-xs text-gray-6">
                    {' '}
                    ·{' '}
                    {d.keyType === 'ed25519'
                      ? 'Ed25519'
                      : d.keyType === 'rsa' && d.bits
                        ? `RSA ${d.bits}-bit`
                        : 'key published'}
                  </span>
                )}
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
