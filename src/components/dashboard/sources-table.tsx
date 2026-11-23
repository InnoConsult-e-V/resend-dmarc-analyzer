'use client';

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { SourceStats } from '@/lib/dashboard/aggregate';
import {
  type Decision,
  type Decisions,
  ipKey,
  reviewOf,
  type ServiceInfo,
  type SourceReview,
} from '@/lib/senders/keys';
import { OutcomeLegend, passRate, SegmentedBar } from './outcomes';
import { SendsAs } from './sends-as';
import { StatusChip, type Tone } from './status-chip';

interface PtrInfo {
  ip: string;
  ptr: string | null;
  verified: boolean;
  org: string | null;
  /** The service the source was identified as, and the key decisions are stored under */
  service?: ServiceInfo | null;
  key?: string;
}

const REVIEW_CHIP: Record<SourceReview, { tone: Tone; label: string }> = {
  approved: { tone: 'good', label: 'Approved' },
  not_mine: { tone: 'neutral', label: 'Not mine' },
  unreviewed: { tone: 'warn', label: 'Unreviewed' },
};

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
  /** Called after a sender was approved / marked as not mine, to refresh readiness. */
  onDecisionChange?: () => void;
}

export function SourcesTable({
  sources,
  limit = DEFAULT_LIMIT,
  failingOnlyDefault = false,
  title = 'Sending sources',
  footer,
  onDecisionChange,
}: SourcesTableProps) {
  const [failingOnly, setFailingOnly] = useState(failingOnlyDefault);
  const [ptrs, setPtrs] = useState<Record<string, PtrInfo>>({});
  const [ptrNote, setPtrNote] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Decisions>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // The admin's saved decisions (approved / not mine).
  useEffect(() => {
    fetch('/api/senders')
      .then((r) => r.json())
      .then((d) => setDecisions(d.decisions ?? {}))
      .catch(() => {});
  }, []);

  const reviewOfRow = useCallback(
    (ip: string): SourceReview =>
      reviewOf(ip, ptrs[ip]?.service ?? null, decisions),
    [ptrs, decisions],
  );

  async function decide(
    keys: string[],
    decision: Decision | 'clear',
    label?: string,
  ) {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch('/api/senders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys, decision, ...(label ? { label } : {}) }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error ?? 'Could not save');
      }
      setDecisions(body.decisions);
      onDecisionChange?.();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  const rows = useMemo(
    () =>
      (failingOnly
        ? sources.filter((s) => s.status === 'failing')
        : sources
      ).slice(0, limit),
    [sources, failingOnly],
  );

  const keyFor = (ip: string) => ptrs[ip]?.key ?? ipKey(ip);
  const bulk = rows.filter(
    (r) => r.status === 'failing' && reviewOfRow(r.ip) === 'unreviewed',
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
            Worst first. Approve the senders that are yours; mark the rest as
            not yours so only real problems stay in view.
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
        {saveError && <p className="mt-2 text-xs text-red">{saveError}</p>}
        {bulk.length > 1 && (
          <button
            type="button"
            disabled={saving}
            onClick={() =>
              decide([...new Set(bulk.map((r) => keyFor(r.ip)))], 'not_mine')
            }
            className="mt-3 rounded-lg border border-gray-3 px-3 py-1.5 text-xs text-gray-9 transition-colors hover:bg-gray-3 disabled:opacity-50"
          >
            Mark all {bulk.length} failing sources shown as not mine
          </button>
        )}
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
              <th className="px-3 py-2 font-normal">Review</th>
              <th className="px-3 py-2 font-normal">Sends as</th>
              <th className="px-5 py-2 font-normal">Reported by</th>
            </tr>
          </thead>
          <tbody className="text-gray-9">
            {rows.length === 0 && (
              <tr className="border-t border-gray-3">
                <td colSpan={8} className="px-5 py-6 text-center text-gray-6">
                  No failing sources in this range.
                </td>
              </tr>
            )}
            {rows.map((s) => {
              const ptr = ptrs[s.ip];
              const chip = chipFor(s, ptr);
              const review = reviewOfRow(s.ip);
              return (
                <tr
                  key={s.ip}
                  id={`source-${s.ip}`}
                  className="border-t border-gray-3 align-top"
                >
                  <td className="px-5 py-2.5">
                    {ptr?.service && (
                      <div className="text-sm text-gray-10">
                        {ptr.service.name}{' '}
                        <span className="text-xs text-gray-6">
                          · {ptr.service.type || 'service'}
                        </span>
                      </div>
                    )}
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
                    <div className="flex flex-col items-start gap-1.5">
                      <StatusChip
                        tone={REVIEW_CHIP[review].tone}
                        label={REVIEW_CHIP[review].label}
                      />
                      <div className="flex flex-wrap gap-1">
                        {review !== 'approved' && (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() =>
                              decide(
                                [keyFor(s.ip)],
                                'approved',
                                ptr?.service?.name ?? s.ip,
                              )
                            }
                            className="rounded border border-gray-3 px-2 py-0.5 text-xs text-gray-8 hover:bg-gray-3 disabled:opacity-50"
                          >
                            Approve
                          </button>
                        )}
                        {review !== 'not_mine' && (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() =>
                              decide(
                                [keyFor(s.ip)],
                                'not_mine',
                                ptr?.service?.name ?? s.ip,
                              )
                            }
                            className="rounded border border-gray-3 px-2 py-0.5 text-xs text-gray-8 hover:bg-gray-3 disabled:opacity-50"
                          >
                            Not mine
                          </button>
                        )}
                        {review !== 'unreviewed' && (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => decide([keyFor(s.ip)], 'clear')}
                            className="rounded px-2 py-0.5 text-xs text-gray-6 underline underline-offset-2 hover:text-gray-9 disabled:opacity-50"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </div>
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
      {Object.values(ptrs).some((p) => p.service) && (
        <p className="border-t border-gray-3 px-5 py-3 text-xs text-gray-6">
          Sender names: parsedmarc's base reverse DNS map (CC BY-SA 4.0),
          derived in part from IPinfo Lite data. Names are best effort.
        </p>
      )}
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
