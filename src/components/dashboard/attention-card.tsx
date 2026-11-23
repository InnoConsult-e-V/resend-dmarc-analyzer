'use client';

import type {
  AttentionItem,
  AttentionSeverity,
} from '@/lib/dashboard/attention';

const SEV: Record<
  AttentionSeverity,
  { icon: string; cls: string; label: string }
> = {
  error: { icon: '✕', cls: 'text-red', label: 'Problem' },
  warn: { icon: '!', cls: 'text-yellow', label: 'Needs review' },
  info: { icon: 'i', cls: 'text-gray-7', label: 'For your information' },
};

/** A short, ranked to-do list for the domain. */
export function AttentionCard({ items }: { items: AttentionItem[] }) {
  return (
    <section className="rounded-xl border border-gray-3 bg-gray-2 p-5">
      <h2 className="text-base font-medium text-gray-10">Needs attention</h2>
      {items.length === 0 ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-gray-7">
          <span className="text-green" aria-hidden="true">
            ✓
          </span>
          Nothing needs your attention right now.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {items.map((i) => (
            <li key={i.id} className="flex items-start gap-3 text-sm">
              <span
                className={`mt-0.5 w-4 shrink-0 text-center font-semibold ${SEV[i.severity].cls}`}
                aria-hidden="true"
              >
                {SEV[i.severity].icon}
              </span>
              <div>
                <p className="text-gray-10">
                  <span className="sr-only">{SEV[i.severity].label}: </span>
                  {i.title}
                </p>
                <p className="text-gray-7">{i.detail}</p>
                {i.ip && (
                  <a
                    href={`#source-${i.ip}`}
                    className="text-xs text-gray-6 underline underline-offset-2 hover:text-gray-9"
                  >
                    Show in the sources table
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
