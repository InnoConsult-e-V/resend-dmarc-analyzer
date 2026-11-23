'use client';

import type { Changes, DomainChange } from '@/lib/dashboard/changes';
import { formatDateTime } from '@/lib/format-date';
import { READINESS_LABEL } from './readiness-chip';

type Tone = 'good' | 'warn' | 'bad' | 'info';
interface Line {
  tone: Tone;
  text: string;
}

const GLYPH: Record<Tone, { icon: string; cls: string; label: string }> = {
  good: { icon: '✓', cls: 'text-green', label: 'Good' },
  warn: { icon: '!', cls: 'text-yellow', label: 'Warning' },
  bad: { icon: '✕', cls: 'text-red', label: 'Problem' },
  info: { icon: 'i', cls: 'text-gray-7', label: 'Info' },
};

const num = (n: number) => n.toLocaleString('en-US');

/** Short sentences describing what changed for one domain. */
export function describeChanges(d: DomainChange, multi: boolean): Line[] {
  const who = multi ? `${d.domain}: ` : '';
  const lines: Line[] = [];

  if (d.newReports > 0) {
    lines.push({
      tone: 'info',
      text: `${who}${num(d.newReports)} new report(s), ${num(d.newMessages)} messages.`,
    });
  }
  if (d.rateDeltaPts !== null && Math.abs(d.rateDeltaPts) >= 0.5) {
    const down = d.rateDeltaPts < 0;
    lines.push({
      tone: down && d.rateDeltaPts <= -2 ? 'bad' : down ? 'warn' : 'good',
      text: `${who}Passed-both rate ${down ? 'fell' : 'rose'} from ${(d.rateBefore as number).toFixed(1)}% to ${(d.rateAfter as number).toFixed(1)}% (${down ? '−' : '+'}${Math.abs(d.rateDeltaPts).toFixed(1)} points).`,
    });
  }
  if (d.policyChange) {
    lines.push({
      tone: 'warn',
      text: `${who}Published policy changed: ${d.policyChange.from} → ${d.policyChange.to}.`,
    });
  }
  if (d.readinessChange) {
    const to = READINESS_LABEL[d.readinessChange.to].label;
    const from = READINESS_LABEL[d.readinessChange.from].label;
    lines.push({
      tone:
        d.readinessChange.to === 'not_ready' ||
        d.readinessChange.to === 'monitoring'
          ? 'warn'
          : 'info',
      text: `${who}Readiness changed: ${from} → ${to}.`,
    });
  }
  for (const s of d.worsenedSources.slice(0, 5)) {
    lines.push({
      tone: 'bad',
      text: `${who}${s.ip} started failing (was ${s.from}): ${num(s.failedBoth)} of ${num(s.messages)} messages failed both checks.`,
    });
  }
  for (const s of d.newSources.slice(0, 5)) {
    lines.push({
      tone:
        s.status === 'failing' ? 'bad' : s.status === 'mixed' ? 'warn' : 'info',
      text: `${who}New sending source ${s.ip} (${num(s.messages)} messages, ${s.status}).`,
    });
  }
  const hidden =
    Math.max(0, d.newSources.length - 5) +
    Math.max(0, d.worsenedSources.length - 5);
  if (hidden > 0) {
    lines.push({
      tone: 'info',
      text: `${who}…and ${hidden} more source change(s).`,
    });
  }
  return lines;
}

interface ChangesCardProps {
  changes: Changes;
  reviewing: boolean;
  onReview: () => void;
}

export function ChangesCard({
  changes,
  reviewing,
  onReview,
}: ChangesCardProps) {
  const multi = changes.domains.length > 1;
  const lines = changes.domains.flatMap((d) => describeChanges(d, multi));

  return (
    <section className="rounded-xl border border-gray-3 bg-gray-2 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-medium text-gray-10">
            Since you last reviewed
          </h2>
          <p className="text-sm text-gray-6">
            {!changes.hasBaseline
              ? 'You have not marked the dashboard as reviewed yet.'
              : `Last reviewed ${formatDateTime(changes.reviewedAt as string)}.`}
          </p>
        </div>
        <button
          type="button"
          onClick={onReview}
          disabled={reviewing}
          className="rounded-xl border border-gray-3 px-4 py-2 text-sm text-gray-9 transition-colors hover:bg-gray-3 disabled:opacity-50"
        >
          {reviewing ? 'Saving…' : 'Mark as reviewed'}
        </button>
      </div>

      {!changes.hasBaseline ? (
        <p className="mt-3 text-sm text-gray-7">
          Mark it as reviewed once you have looked things over. From then on
          this card lists what is new: reports, pass-rate changes, new or
          failing senders, and policy changes.
        </p>
      ) : changes.nothingChanged ? (
        <p className="mt-3 text-sm text-gray-7">
          Nothing has changed since then.
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5 text-sm text-gray-8">
          {lines.map((l) => (
            <li key={`${l.tone}:${l.text}`} className="flex items-start gap-2">
              <span
                className={`mt-0.5 w-4 shrink-0 text-center font-semibold ${GLYPH[l.tone].cls}`}
                aria-hidden="true"
              >
                {GLYPH[l.tone].icon}
              </span>
              <span className="sr-only">{GLYPH[l.tone].label}: </span>
              <span>{l.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
