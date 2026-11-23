'use client';

import { Fragment, useState } from 'react';
import type { DomainStats } from '@/lib/dashboard/aggregate';
import { DnsChip, DnsPanel, type DnsResult } from './dns-panel';
import { OutcomeLegend, passRate, SegmentedBar } from './outcomes';
import { StatusChip } from './status-chip';

interface Props {
  domains: DomainStats[];
  onSelectDomain: (domain: string) => void;
}

type DnsState =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'done'; result: DnsResult };

export function DomainsTable({ domains, onSelectDomain }: Props) {
  const [dns, setDns] = useState<Record<string, DnsState>>({});
  const [open, setOpen] = useState<string | null>(null);

  async function toggleDns(domain: string) {
    if (open === domain) {
      setOpen(null);
      return;
    }
    setOpen(domain);
    if (dns[domain]?.state === 'done') {
      return;
    }
    setDns((d) => ({ ...d, [domain]: { state: 'loading' } }));
    try {
      const res = await fetch(
        `/api/dashboard/dns?domain=${encodeURIComponent(domain)}`,
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? 'DNS check failed');
      }
      setDns((d) => ({ ...d, [domain]: { state: 'done', result: data } }));
    } catch (err) {
      setDns((d) => ({
        ...d,
        [domain]: {
          state: 'error',
          message: err instanceof Error ? err.message : 'DNS check failed',
        },
      }));
    }
  }

  return (
    <section className="rounded-xl border border-gray-3 bg-gray-2">
      <div className="flex flex-wrap items-center justify-between gap-3 p-5 pb-3">
        <h2 className="text-base font-medium text-gray-10">Domains</h2>
        <OutcomeLegend />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-gray-6">
            <tr className="border-t border-gray-3">
              <th className="px-5 py-2 font-normal">Domain</th>
              <th className="px-3 py-2 font-normal">Published policy</th>
              <th className="px-3 py-2 text-right font-normal">Messages</th>
              <th className="px-3 py-2 font-normal">Results</th>
              <th className="px-3 py-2 text-right font-normal">Passed both</th>
              <th className="px-5 py-2 font-normal">DNS</th>
            </tr>
          </thead>
          <tbody className="text-gray-9">
            {domains.map((d) => {
              const state = dns[d.domain];
              return (
                <Fragment key={d.domain}>
                  <tr className="border-t border-gray-3">
                    <td className="px-5 py-2.5">
                      <button
                        type="button"
                        onClick={() => onSelectDomain(d.domain)}
                        className="underline-offset-2 hover:underline"
                        title="Filter the dashboard to this domain"
                      >
                        {d.domain}
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-gray-7">
                      p={d.p}, sp={d.sp}, pct={d.pct}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {d.messages.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5">
                      <SegmentedBar counts={d} />
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {d.messages > 0 ? `${passRate(d).toFixed(1)}%` : '-'}
                    </td>
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-2">
                        {state?.state === 'done' && (
                          <DnsChip severity={state.result.overall} />
                        )}
                        {state?.state === 'error' && (
                          <StatusChip tone="warn" label="Check failed" />
                        )}
                        <button
                          type="button"
                          onClick={() => toggleDns(d.domain)}
                          aria-expanded={open === d.domain}
                          className="text-xs text-gray-6 underline underline-offset-2 hover:text-gray-9"
                        >
                          {state?.state === 'loading'
                            ? 'Checking…'
                            : open === d.domain
                              ? 'Hide'
                              : state
                                ? 'Details'
                                : 'Check DNS'}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {open === d.domain && (
                    <tr>
                      <td colSpan={6} className="p-0">
                        {state?.state === 'done' ? (
                          <DnsPanel result={state.result} />
                        ) : (
                          <p className="border-t border-gray-3 bg-gray-1 px-5 py-4 text-sm text-gray-6">
                            {state?.state === 'error'
                              ? state.message
                              : 'Looking up DNS records…'}
                          </p>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
