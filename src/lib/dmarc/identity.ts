import { getDomain } from 'tldts';

/**
 * Helpers for judging whether an identity domain (From, DKIM d=, SPF,
 * envelope-from) belongs to the domain a report is about. Uses the public
 * suffix list, so mail.example.co.uk and news.example.co.uk are the same
 * organisation. Works in the browser and on the server.
 */

/** The organisational (registrable) domain, lower-cased. */
export function orgDomain(host: string): string {
  const h = host.trim().toLowerCase();
  return getDomain(h) ?? h;
}

/** True when `identity` belongs to the same organisation as one of `policyDomains`. */
export function isOwnDomain(
  identity: string,
  policyDomains: string[],
): boolean {
  const id = orgDomain(identity);
  return policyDomains.some((d) => orgDomain(d) === id);
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

/** Identity domains that do not belong to any of the given policy domains. */
export function externalDomains(
  identities: string[],
  policyDomains: string[],
): string[] {
  return sortedUnique(
    identities
      .filter((d) => d && !isOwnDomain(d, policyDomains))
      .map((d) => d.trim().toLowerCase()),
  );
}
