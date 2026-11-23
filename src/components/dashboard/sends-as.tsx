'use client';

import type { SourceStats } from '@/lib/dashboard/aggregate';

const MAX_SHOWN = 3;

function Domains({
  domains,
  external,
}: {
  domains: string[];
  external: Set<string>;
}) {
  const shown = domains.slice(0, MAX_SHOWN);
  const extra = domains.length - shown.length;
  return (
    <span className="font-mono">
      {shown.map((d, i) => (
        <span key={d}>
          {i > 0 && ', '}
          {external.has(d.toLowerCase()) ? (
            <span
              className="text-yellow"
              title="Not one of your reported domains: a third-party sender, or possibly spoofing"
            >
              <span aria-hidden="true">↗ </span>
              {d}
              <span className="sr-only"> (different domain)</span>
            </span>
          ) : (
            d
          )}
        </span>
      ))}
      {extra > 0 && (
        <span
          className="text-gray-6"
          title={domains.slice(MAX_SHOWN).join(', ')}
        >
          {' '}
          +{extra} more
        </span>
      )}
    </span>
  );
}

/**
 * The identities a sending source mails as: the visible From domain, the DKIM
 * signing domains, the SPF domains and (when reported) the envelope-from.
 * Domains outside the reported domains are marked.
 */
export function SendsAs({ source }: { source: SourceStats }) {
  const external = new Set(source.externalIdentities);
  const rows: Array<[string, string[]]> = [
    ['From', source.headerFrom],
    ['DKIM', source.dkimDomains],
    ['SPF', source.spfDomains],
    ['Envelope', source.envelopeFrom],
  ];
  return (
    <dl className="space-y-0.5 text-xs text-gray-8">
      {rows
        .filter(([, domains]) => domains.length > 0)
        .map(([label, domains]) => (
          <div key={label} className="flex gap-2">
            <dt className="w-14 shrink-0 text-gray-6">{label}</dt>
            <dd>
              <Domains domains={domains} external={external} />
            </dd>
          </div>
        ))}
    </dl>
  );
}
