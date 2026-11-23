'use client';

export type Range = '7' | '30' | '90' | 'all';

const RANGES: Array<{ value: Range; label: string }> = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
];

interface FiltersProps {
  domains: string[];
  domain: string;
  range: Range;
  onDomain: (domain: string) => void;
  onRange: (range: Range) => void;
}

/** One row above everything it scopes. */
export function Filters({
  domains,
  domain,
  range,
  onDomain,
  onRange,
}: FiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div
        role="group"
        aria-label="Date range"
        className="flex rounded-lg border border-gray-3 p-0.5 text-sm"
      >
        {RANGES.map((r) => (
          <button
            key={r.value}
            type="button"
            aria-pressed={range === r.value}
            onClick={() => onRange(r.value)}
            className={`rounded-md px-3 py-1.5 transition-colors ${
              range === r.value
                ? 'bg-gray-3 text-gray-10'
                : 'text-gray-6 hover:text-gray-9'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-6">
        Domain
        <select
          value={domain}
          onChange={(e) => onDomain(e.target.value)}
          className="rounded-lg border border-gray-3 bg-gray-2 px-3 py-1.5 text-sm text-gray-9 focus:border-gray-5 focus:outline-none"
        >
          <option value="">All domains</option>
          {domains.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
