'use client';

import { formatDateTime } from '@/lib/format-date';
import type { DnsResult } from './dns-panel';

const KIND_LABEL: Record<string, string> = {
  dmarc: 'DMARC',
  spf: 'SPF',
  dkim: 'DKIM',
};

/**
 * Changes seen in the domain's DNS records over time. Entries are recorded
 * after every mailbox sync and every DNS check, only when something changed.
 */
export function DnsHistory({
  history,
}: {
  history: NonNullable<DnsResult['history']>;
}) {
  return (
    <section className="rounded-xl border border-gray-3 bg-gray-2">
      <div className="p-5 pb-3">
        <h2 className="text-base font-medium text-gray-10">
          DNS change history
        </h2>
        <p className="text-sm text-gray-6">
          What changed in your DMARC, SPF and DKIM records, and when it was
          first noticed. Recorded after each sync and each check.
        </p>
      </div>
      {history.length === 0 ? (
        <p className="border-t border-gray-3 px-5 py-4 text-sm text-gray-6">
          No history yet. The first check is recorded as the baseline.
        </p>
      ) : (
        <ul className="divide-y divide-gray-3 border-t border-gray-3">
          {history.map((h) => (
            <li key={h.at} className="px-5 py-3 text-sm">
              <p className="text-xs text-gray-6">{formatDateTime(h.at)}</p>
              {h.baseline ? (
                <p className="text-gray-8">
                  First check recorded (the baseline for later changes).
                </p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {h.changes.map((c) => (
                    <li
                      key={c.summary}
                      className="flex items-start gap-2 text-gray-8"
                    >
                      <span className="mt-0.5 w-12 shrink-0 text-xs font-medium text-gray-6">
                        {KIND_LABEL[c.kind] ?? c.kind}
                      </span>
                      <span className="break-words">{c.summary}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
