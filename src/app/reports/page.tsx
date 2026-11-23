'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppHeader } from '@/components/app-header';
import { ReportViewer } from '@/components/dmarc';
import { MailboxControls } from '@/components/mailbox-controls';
import { StatusBanner } from '@/components/status-banner';
import { useHealth } from '@/hooks/use-health';
import { useMailbox } from '@/hooks/use-mailbox';
import { parseAndAnalyze } from '@/lib/dmarc/parser';
import { reviveAnalysis } from '@/lib/dmarc/revive';
import { formatDateTime } from '@/lib/format-date';
import type { DMARCAnalysis } from '@/types/dmarc';

interface FetchedReport {
  analysis: DMARCAnalysis;
  subject: string;
  receivedDateTime: string;
}

export default function ReportsPage() {
  const [xml, setXml] = useState('');
  const [analysis, setAnalysis] = useState<DMARCAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [fetched, setFetched] = useState<FetchedReport[]>([]);
  const [fetchNote, setFetchNote] = useState<string | null>(null);
  const { auth, syncing, sync, signOut, authError, clearAuthError } =
    useMailbox();

  const { health, loadHealth } = useHealth();

  const loadCached = useCallback(async () => {
    try {
      const res = await fetch('/api/reports/cached');
      if (!res.ok) {
        return;
      }
      const data = await res.json();
      const reports = (data.reports as FetchedReport[]).map((r) => ({
        ...r,
        analysis: reviveAnalysis(r.analysis),
      }));
      if (reports.length > 0) {
        // Don't overwrite a fetch that finished while this was loading.
        setFetched((current) => (current.length > 0 ? current : reports));
        setFetchNote(
          `Loaded ${reports.length} report(s) from the local cache (last updated ${formatDateTime(data.lastCachedAt)}). Fetch from mailbox to check for new ones.`,
        );
      }
    } catch {
      // The cache is optional; ignore failures.
    }
  }, []);

  useEffect(() => {
    loadHealth();
    loadCached();
  }, [loadHealth, loadCached]);

  // A failed Microsoft sign-in comes back as ?auth_error=...
  useEffect(() => {
    if (authError) {
      setError(authError);
      clearAuthError();
    }
  }, [authError, clearAuthError]);

  const handleSignOut = async () => {
    await signOut();
    setFetched([]);
    setFetchNote(null);
    loadHealth();
  };

  const handleAnalyze = () => {
    if (!xml.trim()) {
      setError('Please paste a DMARC report XML');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = parseAndAnalyze(xml);
      setAnalysis(result);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to parse DMARC report',
      );
      setAnalysis(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFetch = async (refresh = false) => {
    setError(null);
    setFetchNote(null);
    const result = await sync({ refresh });
    if (result.ok) {
      const { data } = result;
      setFetched(
        (data.reports as FetchedReport[]).map((r) => ({
          ...r,
          analysis: reviveAnalysis(r.analysis),
        })),
      );
      const errs: string[] = data.errors ?? [];
      setFetchNote(
        `${data.reports.length} report(s) from ${data.messages} message(s) (${data.cached} cached, ${data.fetched} new)` +
          (errs.length ? `. Errors: ${errs.join('; ')}` : ''),
      );
    } else {
      setError(result.error);
    }
    loadHealth();
  };

  const handleClear = () => {
    setXml('');
    setAnalysis(null);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader health={health} onRecheck={loadHealth} />

      <StatusBanner
        error={error}
        note={fetchNote}
        onDismissError={() => setError(null)}
        onDismissNote={() => setFetchNote(null)}
      />

      <main className="max-w-6xl mx-auto px-4 py-8">
        {!analysis ? (
          <div className="space-y-6">
            {/* Hero */}
            <div className="text-center py-8">
              <h2 className="text-3xl font-semibold text-gray-10 mb-3">
                Reports
              </h2>
              <p className="text-gray-6 max-w-lg mx-auto">
                Paste your DMARC aggregate report (RUA) XML below to get a
                detailed breakdown of your email authentication results.
              </p>
            </div>

            {/* Mailbox */}
            <div className="space-y-4">
              <MailboxControls
                auth={auth}
                syncing={syncing}
                onSync={handleFetch}
                onSignOut={handleSignOut}
              />
              {fetched.length > 0 && (
                <ul className="divide-y divide-gray-3 border border-gray-3 rounded-xl">
                  {fetched.map((r, i) => (
                    <li
                      key={`${r.analysis.report.report_metadata.report_id}-${i}`}
                    >
                      <button
                        onClick={() => setAnalysis(r.analysis)}
                        className="w-full text-left px-4 py-3 text-sm text-gray-9 hover:bg-gray-2 transition-colors"
                      >
                        {r.analysis.report.report_metadata.org_name} —{' '}
                        {r.analysis.report.policy_published.domain}
                        <span className="text-gray-6">
                          {' '}
                          · {formatDateTime(r.receivedDateTime)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Input Area */}
            <div className="space-y-4">
              <div className="relative">
                <textarea
                  value={xml}
                  onChange={(e) => setXml(e.target.value)}
                  placeholder="Paste your DMARC XML here..."
                  className="w-full h-80 bg-gray-2 border border-gray-3 rounded-xl p-4 font-mono text-sm text-gray-9 placeholder-gray-5 focus:outline-none focus:border-gray-5 resize-none"
                />
                {xml && (
                  <button
                    onClick={handleClear}
                    className="absolute top-3 right-3 text-gray-5 hover:text-gray-7 transition-colors"
                    aria-label="Clear input"
                  >
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                )}
              </div>

              <button
                onClick={handleAnalyze}
                disabled={isLoading || !xml.trim()}
                className="w-full bg-gray-10 text-gray-1 font-medium py-3 px-6 rounded-xl hover:bg-gray-9 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isLoading ? 'Analyzing...' : 'Analyze report'}
              </button>
            </div>

            {/* Info */}
            <div className="border border-gray-3 rounded-xl p-6 mt-8">
              <h3 className="text-lg font-medium text-gray-10 mb-4">
                What is DMARC?
              </h3>
              <p className="text-sm text-gray-7 leading-relaxed">
                DMARC (Domain-based Message Authentication, Reporting &
                Conformance) is an email authentication protocol that protects
                your domain from being used for email spoofing. DMARC aggregate
                reports (RUA) are sent by email receivers to help you understand
                how your domain&apos;s email is being authenticated.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Back button */}
            <button
              onClick={handleClear}
              className="flex items-center gap-2 text-sm text-gray-6 hover:text-gray-9 transition-colors cursor-pointer"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="15 18 9 12 15 6" />
              </svg>
              Analyze another report
            </button>

            {/* Report Viewer */}
            <ReportViewer analysis={analysis} />
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-3 mt-16">
        <div className="max-w-6xl mx-auto px-4 py-6 flex flex-col md:flex-row md:items-center justify-between gap-4 text-sm text-gray-6">
          <a
            href="https://github.com/resend/resend-dmarc-analyzer"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-gray-9 transition-colors"
          >
            DMARC Analyzer
          </a>
          <div className="flex flex-wrap items-center gap-4">
            <a
              href="https://resend.com/blog/how-to-read-a-dmarc-report"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-gray-9 transition-colors"
            >
              How to read a DMARC report
            </a>
            <a
              href="https://resend.com/blog/dmarc-policy-modes"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-gray-9 transition-colors"
            >
              DMARC policy modes
            </a>
            <a
              href="https://resend.com/blog/how-dmarc-applies-to-subdomains"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-gray-9 transition-colors"
            >
              DMARC and subdomains
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
