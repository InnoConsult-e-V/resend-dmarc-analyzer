'use client';

export type Tone = 'good' | 'warn' | 'bad' | 'neutral';

const TONES: Record<Tone, { cls: string; icon: string }> = {
  good: { cls: 'bg-green-dim text-green', icon: '✓' },
  warn: { cls: 'bg-yellow-dim text-yellow', icon: '!' },
  bad: { cls: 'bg-red-dim text-red', icon: '✕' },
  neutral: { cls: 'bg-gray-3 text-gray-7', icon: '–' },
};

/** Status chip: icon + label, never colour alone. */
export function StatusChip({ tone, label }: { tone: Tone; label: string }) {
  const t = TONES[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${t.cls}`}
    >
      <span aria-hidden="true">{t.icon}</span>
      {label}
    </span>
  );
}
