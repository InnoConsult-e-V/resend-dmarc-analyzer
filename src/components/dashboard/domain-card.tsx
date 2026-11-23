'use client';

import Link from 'next/link';
import type { OverviewDomain } from '@/lib/dashboard/overview';
import { formatPolicy } from '@/lib/dmarc/policy';
import { ReadinessChip } from './readiness-chip';
import { StatusChip } from './status-chip';

const pct = (v: number | null) => (v === null ? '-' : `${v.toFixed(1)}%`);

export function DomainCard({ domain }: { domain: OverviewDomain }) {
  const { readiness: r } = domain;
  const policy = formatPolicy(r.published);
  const todo = (domain.attention ?? []).filter((a) => a.severity !== 'info');
  const worst = todo.some((a) => a.severity === 'error') ? 'bad' : 'warn';
  return (
    <Link
      href={`/domains/${encodeURIComponent(domain.domain)}`}
      className="block rounded-xl border border-gray-3 bg-gray-2 p-5 transition-colors hover:border-gray-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-lg font-medium text-gray-10">{domain.domain}</h3>
        <ReadinessChip status={r.status} />
      </div>
      <p className="mt-1 font-mono text-xs text-gray-6">{policy}</p>

      <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-gray-6">Survives enforcement</dt>
          <dd className="text-lg font-medium text-gray-10">
            {pct(r.metrics.survivesPct)}
          </dd>
        </div>
        <div>
          <dt className="text-gray-6">Passed both</dt>
          <dd className="text-lg font-medium text-gray-10">
            {pct(r.metrics.passedBothPct)}
          </dd>
        </div>
        <div>
          <dt className="text-gray-6">
            Messages ({r.metrics.windowDays} days)
          </dt>
          <dd className="text-lg font-medium tabular-nums text-gray-10">
            {domain.totals.messages.toLocaleString('en-US')}
          </dd>
        </div>
      </dl>

      {todo.length > 0 && (
        <p className="mt-4">
          <StatusChip
            tone={worst}
            label={`${todo.length} ${todo.length === 1 ? 'item needs' : 'items need'} attention`}
          />
        </p>
      )}
      <p className="mt-4 text-sm text-gray-8">{r.nextStep}</p>
      <p className="mt-3 text-xs text-gray-6 underline underline-offset-2">
        Open {domain.domain} →
      </p>
    </Link>
  );
}
