'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AppHeader } from '@/components/app-header';
import { DomainsTable } from '@/components/dashboard/domains-table';
import { Filters, type Range } from '@/components/dashboard/filters';
import { passRate } from '@/components/dashboard/outcomes';
import { SourcesTable } from '@/components/dashboard/sources-table';
import { StackedDailyChart } from '@/components/dashboard/stacked-daily-chart';
import { SummaryCard } from '@/components/dmarc/summary-card';
import { StatusBanner } from '@/components/status-banner';
import { useHealth } from '@/hooks/use-health';
import type { DashboardData } from '@/lib/dashboard/aggregate';

const RANGE_LABEL: Record<Range, string> = {
  '7': 'the last 7 days',
  '30': 'the last 30 days',
  '90': 'the last 90 days',
  all: 'all time',
};

export default function DashboardPage() {
  const { health, loadHealth } = useHealth();
  const [range, setRange] = useState<Range>('30');
  const [domain, setDomain] = useState('');
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Domains list stays stable while filtering by one domain.
  const [allDomains, setAllDomains] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ days: range });
      if (domain) {
        qs.set('domain', domain);
      }
      const res = await fetch(`/api/dashboard?${qs}`);
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error ?? 'Failed to load the dashboard');
      }
      setData(body);
      if (!domain) {
        setAllDomains(body.availableDomains);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load the dashboard',
      );
    } finally {
      setLoading(false);
    }
  }, [range, domain]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadHealth();
  }, [loadHealth]);

  const t = data?.totals;
  const rate = t ? passRate(t) : 0;
  const scope = `${domain || 'All domains'}, ${RANGE_LABEL[range]}`;
  const neverFetched = data !== null && data.availableDomains.length === 0;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader health={health} onRecheck={loadHealth} />
      <StatusBanner
        error={error}
        note={null}
        onDismissError={() => setError(null)}
        onDismissNote={() => {}}
      />

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        <Filters
          domains={allDomains}
          domain={domain}
          range={range}
          onDomain={setDomain}
          onRange={setRange}
        />

        {neverFetched ? (
          <div className="rounded-xl border border-gray-3 bg-gray-2 p-10 text-center">
            <p className="text-gray-9">No cached reports yet.</p>
            <p className="mt-1 text-sm text-gray-6">
              <Link href="/" className="underline underline-offset-2">
                Fetch from your mailbox
              </Link>{' '}
              first; the dashboard reads the local cache.
            </p>
          </div>
        ) : (
          data &&
          t && (
            // Hold the previous render (dimmed) while refetching: no layout jump.
            <div
              className={`space-y-6 transition-opacity ${loading ? 'opacity-60' : ''}`}
              aria-busy={loading}
            >
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <SummaryCard
                  title="Reports"
                  value={data.reports.toLocaleString()}
                  subtitle={
                    data.duplicatesSkipped > 0
                      ? `${data.duplicatesSkipped} duplicate(s) skipped`
                      : `${data.reporters.length} reporter(s)`
                  }
                />
                <SummaryCard
                  title="Messages"
                  value={t.messages.toLocaleString()}
                  subtitle={`${data.sources.length.toLocaleString()} sending source(s)`}
                />
                <SummaryCard
                  title="Passed both (DKIM + SPF)"
                  value={t.messages > 0 ? `${rate.toFixed(1)}%` : '-'}
                  subtitle={`${t.passedBoth.toLocaleString()} of ${t.messages.toLocaleString()}`}
                  variant={
                    t.messages === 0
                      ? 'default'
                      : rate >= 95
                        ? 'success'
                        : rate >= 80
                          ? 'warning'
                          : 'danger'
                  }
                />
                <SummaryCard
                  title="Quarantined / rejected"
                  value={`${t.quarantined.toLocaleString()} / ${t.rejected.toLocaleString()}`}
                  subtitle={`${t.failedBoth.toLocaleString()} failed both`}
                />
              </div>

              <StackedDailyChart
                daily={data.daily}
                title="Daily messages by authentication result"
                subtitle={`${scope} · UTC days`}
              />

              {data.domains.length > 0 && (
                <DomainsTable
                  domains={data.domains}
                  onSelectDomain={setDomain}
                />
              )}
              {data.sources.length > 0 && (
                <SourcesTable sources={data.sources} />
              )}
            </div>
          )
        )}
      </main>
    </div>
  );
}
