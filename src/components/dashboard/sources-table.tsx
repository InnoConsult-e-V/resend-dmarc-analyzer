'use client';

import { type ReactNode, useEffect, useMemo, useState } from 'react';
import type { SourceStats } from '@/lib/dashboard/aggregate';
import { OutcomeLegend, passRate, SegmentedBar } from './outcomes';
import { SendsAs } from './sends-as';
import { StatusChip, type Tone } from './status-chip';

interface PtrInfo {
  ip: string;
  ptr: string | null;
  verified: boolean;
  org: string | null;
}

const DEFAULT_LIMIT = 50;
/** A failing source needs at least this many messages to be flagged. */
const SUSPICIOUS_MIN_MESSAGES = 10;

function chipFor(
  s: SourceStats,
  ptr: PtrInfo | undefined,
): { tone: Tone; label: string } {
  if (s.status === 'healthy') {
    return { tone: 'good', label: 'Healthy' };
  }
  if (s.status === 'mixed') {
    return { tone: 'warn', label: 'Mixed' };
  }
  const suspicious =
    ptr !== undefined && !ptr.verified && s.messages >= SUSPICIOUS_MIN_MESSAGES;
  return { tone: 'bad', label: suspicious ? 'Suspicious' : 'Failing' };
}

interface SourcesTableProps {
  sources: SourceStats[];
  /** Rows shown (default 50). */
  limit?: number;
  /** Start with only failing sources shown. */
  failingOnlyDefault?: boolean;
  title?: string;
  /** Extra footer content, e.g. a link to the full list. */
  footer?: ReactNode;
}

export function SourcesTable({
  sources,
  limit = DEFAULT_LIMIT,
  failingOnlyDefault = false,
  title = 'Sending sources',
  footer,
}: SourcesTableProps) {
  const [failingOnly, setFailingOnly] = useState(failingOnlyDefault);
  const [ptrs, setPtrs] = useState<Record<string, PtrInfo>>({});
  const [ptrNote, setPtrNote] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      (failingOnly
        ? sources.filter((s) => s.status === 'failing')
        : sources
      ).slice(0, limit),
    [sources, failingOnly],
  );

  // Fill in reverse DNS for the rows on screen (cached on the server).
  // `ptrs` is intentionally not a dependency: it would re-run after each fill.
  useEffect(() => {
    const missing = rows.map((s) => s.ip).filter((ip) => !ptrs[ip]);
    if (missing.length === 0) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/dashboard/enrich', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ips: missing }),
        });
        if (!res.ok) {
          throw new Error('lookup failed');
        }
        const data = (await res.json()) as { results: PtrInfo[] };
        if (!cancelled) {
          setPtrs((p) => ({
            ...p,
            ...Object.fromEntries(data.results.map((r) => [r.ip, r])),
          }));
          setPtrNote(null);
        }
      } catch {
        if (!cancelled) {
          setPtrNote('Reverse DNS lookup is unavailable right now.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rows]);

  return (
    <section className="rounded-xl border border-gray-3 bg-gray-2">
      <div className="flex flex-wrap items-center justify-between gap-3 p-5 pb-3">
        <div>
          <h2 className="text-base font-medium text-gray-10">{title}</h2>
          <p className="text-sm text-gray-6">
            Worst first. Names come from reverse DNS, confirmed by a forward
            lookup.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-7">
          <input
            type="checkbox"
            checked={failingOnly}
            onChange={(e) => setFailingOnly(e.target.checked)}
          />
          Failing only
        </label>
      </div>
      <div className="px-5 pb-3">
        <OutcomeLegend />
        {ptrNote && <p className="mt-2 text-xs text-gray-6">{ptrNote}</p>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-gray-6">
            <tr className="border-t border-gray-3">
              <th className="px-5 py-2 font-normal">Source</th>
              <th className="px-3 py-2 text-right font-normal">Messages</th>
              <th className="px-3 py-2 font-normal">Results</th>
              <th className="px-3 py-2 text-right font-normal">Passed both</th>
              <th className="px-3 py-2 font-normal">Status</th>
              <th className="px-3 py-2 font-normal">Sends as</th>
              <th className="px-5 py-2 font-normal">Reported by</th>
            </tr>
          </thead>
          <tbody className="text-gray-9">
            {rows.length === 0 && (
              <tr className="border-t border-gray-3">
                <td colSpan={7} className="px-5 py-6 text-center text-gray-6">
                  No failing sources in this range.
                </td>
              </tr>
            )}
            {rows.map((s) => {
              const ptr = ptrs[s.ip];
              const chip = chipFor(s, ptr);
              return (
                <tr key={s.ip} className="border-t border-gray-3 align-top">
                  <td className="px-5 py-2.5">
                    <div className="font-mono text-xs">{s.ip}</div>
                    <div className="text-xs text-gray-6">
                      {ptr === undefined
                        ? 'Looking up…'
                        : ptr.ptr
                          ? `${ptr.ptr}${ptr.verified ? '' : ' (not confirmed)'}`
                          : 'No reverse DNS'}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {s.messages.toLocaleString()}
                  </td>
                  <td className="px-3 py-3">
                    <SegmentedBar counts={s} />
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {s.messages > 0 ? `${passRate(s).toFixed(1)}%` : '-'}
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusChip tone={chip.tone} label={chip.label} />
                  </td>
                  <td className="px-3 py-2.5">
                    <SendsAs source={s} />
                  </td>
                  <td className="px-5 py-2.5 text-xs text-gray-7">
                    {s.reporters.join(', ')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {(sources.length > limit || footer) && (
        <p className="border-t border-gray-3 px-5 py-3 text-xs text-gray-6">
          {sources.length > limit && (
            <>
              Showing the first {limit} of {sources.length.toLocaleString()}{' '}
              sources.{' '}
            </>
          )}
          {footer}
        </p>
      )}
    </section>
  );
}
