'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppHeader } from '@/components/app-header';
import { ChangesCard } from '@/components/dashboard/changes-card';
import { DomainCard } from '@/components/dashboard/domain-card';
import { Filters, type Range } from '@/components/dashboard/filters';
import { passRate } from '@/components/dashboard/outcomes';
import { SourcesTable } from '@/components/dashboard/sources-table';
import { StackedDailyChart } from '@/components/dashboard/stacked-daily-chart';
import { SummaryCard } from '@/components/dmarc/summary-card';
import { MailboxControls } from '@/components/mailbox-controls';
import { StatusBanner } from '@/components/status-banner';
import { useHealth } from '@/hooks/use-health';
import { useMailbox } from '@/hooks/use-mailbox';
import type { DashboardData } from '@/lib/dashboard/aggregate';
import type { Overview } from '@/lib/dashboard/overview';

const RANGE_LABEL: Record<Range, string> = {
  '7': 'the last 7 days',
  '30': 'the last 30 days',
  '90': 'the last 90 days',
  all: 'all time',
};

export default function DashboardPage() {
  const { health, loadHealth } = useHealth();
  const { auth, syncing, sync, signOut, authError, clearAuthError } =
    useMailbox();

  const [range, setRange] = useState<Range>('30');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [o, d] = await Promise.all([
        fetch('/api/overview').then((r) => r.json()),
        fetch(`/api/dashboard?days=${range}`).then(async (r) => {
          const body = await r.json();
          if (!r.ok) {
            throw new Error(body.error ?? 'Failed to load the dashboard');
          }
          return body;
        }),
      ]);
      setOverview(o);
      setData(d);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load the dashboard',
      );
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadHealth();
  }, [loadHealth]);

  // A failed Microsoft sign-in comes back as ?auth_error=...
  useEffect(() => {
    if (authError) {
      setError(authError);
      clearAuthError();
    }
  }, [authError, clearAuthError]);

  async function handleSync(refresh: boolean) {
    setError(null);
    setNote(null);
    const result = await sync({ refresh, slim: true });
    if (result.ok) {
      const { data: r } = result;
      const errs: string[] = r.errors ?? [];
      setNote(
        `Synced: ${r.reportCount} report(s) from ${r.messages} message(s) (${r.cached} already cached, ${r.fetched} new)` +
          (errs.length ? `. Errors: ${errs.join('; ')}` : '.'),
      );
      await load();
    } else {
      setError(result.error);
    }
    loadHealth();
  }

  async function handleReview() {
    setReviewing(true);
    try {
      const res = await fetch('/api/review', { method: 'POST' });
      if (!res.ok) {
        throw new Error('Could not save the review time');
      }
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not save the review time',
      );
    } finally {
      setReviewing(false);
    }
  }

  const t = data?.totals;
  const rate = t ? passRate(t) : 0;
  const empty = overview !== null && overview.domains.length === 0;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader health={health} onRecheck={loadHealth} />
      <StatusBanner
        error={error}
        note={note}
        onDismissError={() => setError(null)}
        onDismissNote={() => setNote(null)}
      />

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        <MailboxControls
          auth={auth}
          syncing={syncing}
          onSync={handleSync}
          onSignOut={async () => {
            await signOut();
            loadHealth();
          }}
          lastSyncAt={overview ? overview.sync.lastSyncAt : undefined}
        />

        {empty ? (
          <div className="rounded-xl border border-gray-3 bg-gray-2 p-10 text-center">
            <p className="text-gray-9">No reports in the local cache yet.</p>
            <p className="mt-1 text-sm text-gray-6">
              Sign in and use <strong>Sync mailbox</strong> to load your DMARC
              reports.
            </p>
          </div>
        ) : (
          overview &&
          data &&
          t && (
            // Hold the previous render (dimmed) while refetching: no layout jump.
            <div
              className={`space-y-6 transition-opacity ${loading ? 'opacity-60' : ''}`}
              aria-busy={loading}
            >
              <ChangesCard
                changes={overview.changes}
                reviewing={reviewing}
                onReview={handleReview}
              />

              <section aria-label="Domains" className="space-y-3">
                <h2 className="text-base font-medium text-gray-10">Domains</h2>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {overview.domains.map((d) => (
                    <DomainCard key={d.domain} domain={d} />
                  ))}
                </div>
              </section>

              <section aria-label="Trends" className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-base font-medium text-gray-10">Trends</h2>
                  <Filters range={range} onRange={setRange} />
                </div>

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
                  subtitle={`All domains, ${RANGE_LABEL[range]} · UTC days`}
                />
              </section>

              {data.sources.length > 0 && (
                <SourcesTable
                  sources={data.sources}
                  limit={5}
                  failingOnlyDefault
                  title="Top failing sources"
                  footer="Open a domain above for its full list of sources and DNS checks."
                />
              )}
            </div>
          )
        )}
      </main>
    </div>
  );
}
