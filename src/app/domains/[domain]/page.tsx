'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AppHeader } from '@/components/app-header';
import { DnsPanel, type DnsResult } from '@/components/dashboard/dns-panel';
import { Filters, type Range } from '@/components/dashboard/filters';
import { passRate } from '@/components/dashboard/outcomes';
import { ReadinessCard } from '@/components/dashboard/readiness-card';
import { SourcesTable } from '@/components/dashboard/sources-table';
import { StackedDailyChart } from '@/components/dashboard/stacked-daily-chart';
import { SummaryCard } from '@/components/dmarc/summary-card';
import { StatusBanner } from '@/components/status-banner';
import { useHealth } from '@/hooks/use-health';
import type { DashboardData } from '@/lib/dashboard/aggregate';
import type { Overview } from '@/lib/dashboard/overview';
import { withDns } from '@/lib/dashboard/readiness';

const RANGE_LABEL: Record<Range, string> = {
  '7': 'the last 7 days',
  '30': 'the last 30 days',
  '90': 'the last 90 days',
  all: 'all time',
};

export default function DomainPage() {
  const params = useParams<{ domain: string }>();
  const domain = decodeURIComponent(params.domain);
  const { health, loadHealth } = useHealth();

  const [range, setRange] = useState<Range>('30');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [dns, setDns] = useState<DnsResult | null>(null);
  const [dnsLoading, setDnsLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [unknown, setUnknown] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ days: range, domain });
      const [o, dres] = await Promise.all([
        fetch('/api/overview').then((r) => r.json() as Promise<Overview>),
        fetch(`/api/dashboard?${qs}`),
      ]);
      setOverview(o);
      if (dres.status === 400) {
        setUnknown(true);
        return;
      }
      const body = await dres.json();
      if (!dres.ok) {
        throw new Error(body.error ?? 'Failed to load the domain');
      }
      setUnknown(false);
      setData(body);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load the domain',
      );
    } finally {
      setLoading(false);
    }
  }, [range, domain]);

  const loadDns = useCallback(async () => {
    setDnsLoading(true);
    try {
      const res = await fetch(
        `/api/dashboard/dns?domain=${encodeURIComponent(domain)}`,
      );
      if (res.ok) {
        setDns(await res.json());
      } else {
        setDns(null);
      }
    } catch {
      setDns(null);
    } finally {
      setDnsLoading(false);
    }
  }, [domain]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadDns();
  }, [loadDns]);

  useEffect(() => {
    loadHealth();
  }, [loadHealth]);

  const entry = overview?.domains.find((d) => d.domain === domain);
  const readiness =
    entry && dns ? withDns(entry.readiness, dns) : entry?.readiness;
  const t = data?.totals;
  const rate = t ? passRate(t) : 0;

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
        <div>
          <Link
            href="/"
            className="text-sm text-gray-6 underline-offset-2 hover:text-gray-9 hover:underline"
          >
            ← Dashboard
          </Link>
          <h2 className="mt-2 text-2xl font-semibold text-gray-10">{domain}</h2>
        </div>

        {unknown || (overview && !entry) ? (
          <div className="rounded-xl border border-gray-3 bg-gray-2 p-10 text-center">
            <p className="text-gray-9">No cached reports for {domain}.</p>
            <p className="mt-1 text-sm text-gray-6">
              <Link href="/" className="underline underline-offset-2">
                Back to the dashboard
              </Link>
            </p>
          </div>
        ) : (
          readiness &&
          data &&
          t && (
            <div
              className={`space-y-6 transition-opacity ${loading ? 'opacity-60' : ''}`}
              aria-busy={loading}
            >
              <ReadinessCard readiness={readiness} dnsLoading={dnsLoading} />

              <section aria-label="Trends" className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-base font-medium text-gray-10">Trends</h2>
                  <Filters range={range} onRange={setRange} />
                </div>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <SummaryCard
                    title="Reports"
                    value={data.reports.toLocaleString()}
                    subtitle={`${data.reporters.length} reporter(s)`}
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
                  subtitle={`${domain}, ${RANGE_LABEL[range]} · UTC days`}
                />
              </section>

              <section className="rounded-xl border border-gray-3 bg-gray-2">
                <div className="flex flex-wrap items-center justify-between gap-3 p-5">
                  <div>
                    <h2 className="text-base font-medium text-gray-10">
                      DNS records
                    </h2>
                    <p className="text-sm text-gray-6">
                      Live DMARC, SPF and DKIM lookup through your own DNS
                      resolver.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={loadDns}
                    disabled={dnsLoading}
                    className="rounded-xl border border-gray-3 px-4 py-2 text-sm text-gray-9 transition-colors hover:bg-gray-3 disabled:opacity-50"
                  >
                    {dnsLoading ? 'Checking…' : 'Check again'}
                  </button>
                </div>
                {dns ? (
                  <DnsPanel result={dns} />
                ) : (
                  <p className="border-t border-gray-3 bg-gray-1 px-5 py-4 text-sm text-gray-6">
                    {dnsLoading
                      ? 'Looking up DNS records…'
                      : 'The DNS check is not available right now.'}
                  </p>
                )}
              </section>

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
