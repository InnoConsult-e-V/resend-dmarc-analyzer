'use client';

import type { Counts } from '@/lib/dashboard/aggregate';

/**
 * The three authentication outcomes. They mean good / warning / bad, so they
 * use the fixed status colours, and each carries an icon and a label so colour
 * is never the only signal. (The status palette is not themed; the yellow sits
 * outside the categorical lightness band by design.)
 */
export type OutcomeKey = 'passedBoth' | 'passedOne' | 'failedBoth';

export interface Outcome {
  key: OutcomeKey;
  label: string;
  short: string;
  color: string;
  /** Ink for the glyph drawn on the colour. */
  ink: string;
  glyph: 'check' | 'dash' | 'cross';
}

export const OUTCOMES: Outcome[] = [
  {
    key: 'passedBoth',
    label: 'Passed both (DKIM + SPF)',
    short: 'Passed both',
    color: '#0ca30c',
    ink: '#ffffff',
    glyph: 'check',
  },
  {
    key: 'passedOne',
    label: 'Passed one',
    short: 'Passed one',
    color: '#fab219',
    ink: '#0b0b0b',
    glyph: 'dash',
  },
  {
    key: 'failedBoth',
    label: 'Failed both',
    short: 'Failed both',
    color: '#d03b3b',
    ink: '#ffffff',
    glyph: 'cross',
  },
];

export function passRate(c: Pick<Counts, 'messages' | 'passedBoth'>): number {
  return c.messages > 0 ? (c.passedBoth / c.messages) * 100 : 0;
}

function Glyph({ kind, ink }: { kind: Outcome['glyph']; ink: string }) {
  const path =
    kind === 'check'
      ? 'M3.5 7.2 6 9.7 10.5 4.7'
      : kind === 'dash'
        ? 'M4 7h6'
        : 'M4.5 4.5 9.5 9.5M9.5 4.5 4.5 9.5';
  return (
    <path
      d={path}
      stroke={ink}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  );
}

/** Colour swatch with its icon drawn on it: identity is never colour alone. */
export function Swatch({ outcome }: { outcome: Outcome }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <rect width="14" height="14" rx="3" fill={outcome.color} />
      <Glyph kind={outcome.glyph} ink={outcome.ink} />
    </svg>
  );
}

export function OutcomeLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-gray-8">
      {OUTCOMES.map((o) => (
        <li key={o.key} className="flex items-center gap-2">
          <Swatch outcome={o} />
          {o.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Thin segmented bar: how one row's messages split across the outcomes. No
 * text on the bar: the figures sit beside it, and one legend covers the table.
 */
export function SegmentedBar({ counts }: { counts: Counts }) {
  const total = OUTCOMES.reduce((sum, o) => sum + counts[o.key], 0);
  const summary = OUTCOMES.map(
    (o) => `${o.short} ${counts[o.key].toLocaleString()}`,
  ).join(', ');
  return (
    <div
      role="img"
      aria-label={summary}
      title={summary}
      className="flex h-2 w-24 gap-0.5 overflow-hidden rounded-full bg-gray-3"
    >
      {total > 0 &&
        OUTCOMES.map((o) =>
          counts[o.key] > 0 ? (
            <span
              key={o.key}
              style={{
                width: `${(counts[o.key] / total) * 100}%`,
                background: o.color,
              }}
            />
          ) : null,
        )}
    </div>
  );
}
