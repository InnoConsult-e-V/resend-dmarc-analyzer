'use client';

import type { Readiness } from '@/lib/dashboard/readiness';
import { formatPolicy } from '@/lib/dmarc/policy';
import { ReadinessChip } from './readiness-chip';

const SEV = {
  ok: { icon: '✓', cls: 'text-green', label: 'OK' },
  info: { icon: 'i', cls: 'text-gray-7', label: 'Info' },
  warn: { icon: '!', cls: 'text-yellow', label: 'Warning' },
  error: { icon: '✕', cls: 'text-red', label: 'Problem' },
} as const;

const pct = (v: number | null) => (v === null ? '-' : `${v.toFixed(1)}%`);

interface Props {
  readiness: Readiness;
  /** True while the DNS check is still running (its checks are added when done). */
  dnsLoading?: boolean;
}

export function ReadinessCard({ readiness: r, dnsLoading }: Props) {
  const m = r.metrics;
  return (
    <section className="rounded-xl border border-gray-3 bg-gray-2 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-medium text-gray-10">
            Policy readiness
          </h2>
          <p className="text-sm text-gray-6">
            Based on the last {m.windowDays} days
            {r.published
              ? ` · published policy ${formatPolicy(r.published)}`
              : ''}
          </p>
        </div>
        <ReadinessChip status={r.status} />
      </div>

      <p className="mt-4 rounded-lg bg-gray-1 px-4 py-3 text-sm text-gray-9">
        <span className="font-medium text-gray-10">Next step: </span>
        {r.nextStep}
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <div>
          <dt className="text-gray-6">Survives enforcement</dt>
          <dd className="text-base font-medium text-gray-10">
            {pct(m.survivesPct)}
          </dd>
        </div>
        <div>
          <dt className="text-gray-6">Failed both</dt>
          <dd className="text-base font-medium text-gray-10">
            {pct(m.failedBothPct)}
          </dd>
        </div>
        <div>
          <dt className="text-gray-6">Passed both</dt>
          <dd className="text-base font-medium text-gray-10">
            {pct(m.passedBothPct)}
          </dd>
        </div>
        <div>
          <dt className="text-gray-6">Report days / messages</dt>
          <dd className="text-base font-medium tabular-nums text-gray-10">
            {m.reportDays} / {m.messages.toLocaleString('en-US')}
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-gray-6">
        “Survives enforcement” counts every message that passed at least one of
        DKIM or SPF, which is what DMARC requires. “Passed both” is the stricter
        figure used elsewhere.
      </p>

      <h3 className="mt-5 text-sm font-medium text-gray-10">Checklist</h3>
      <ul className="mt-2 space-y-2">
        {r.checks.map((c) => (
          <li key={c.id} className="flex items-start gap-3 text-sm">
            <span
              className={`mt-0.5 w-4 shrink-0 text-center font-semibold ${SEV[c.severity].cls}`}
              aria-hidden="true"
            >
              {SEV[c.severity].icon}
            </span>
            <span className="text-gray-8">
              <span className="sr-only">{SEV[c.severity].label}: </span>
              <span className="font-medium text-gray-10">{c.title}.</span>{' '}
              {c.message}
            </span>
          </li>
        ))}
        {dnsLoading && (
          <li className="flex items-start gap-3 text-sm text-gray-6">
            <span
              className="mt-0.5 w-4 shrink-0 text-center"
              aria-hidden="true"
            >
              …
            </span>
            Checking DNS records…
          </li>
        )}
      </ul>

      {r.sourcesToReview.length > 0 && (
        <>
          <h3 className="mt-5 text-sm font-medium text-gray-10">
            Failing senders to review
          </h3>
          <ul className="mt-2 divide-y divide-gray-3 rounded-lg border border-gray-3 text-sm">
            {r.sourcesToReview.map((s) => (
              <li
                key={s.ip}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
              >
                <span className="font-mono text-xs text-gray-9">{s.ip}</span>
                <span className="text-xs text-gray-7">
                  {s.headerFrom.join(', ')}
                  {s.externalIdentities.length > 0 && (
                    <span className="text-yellow">
                      {' '}
                      <span aria-hidden="true">↗ </span>
                      other identities:{' '}
                      {s.externalIdentities.slice(0, 2).join(', ')}
                    </span>
                  )}
                </span>
                <span className="tabular-nums text-gray-8">
                  {s.failedBoth.toLocaleString('en-US')} failed (
                  {(s.share * 100).toFixed(1)}%)
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
