/** Small pure parsers for DNS TXT record text shared by the DNS modules. */

export function parseTags(record: string): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const part of record.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      tags[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
    }
  }
  return tags;
}

/** SPF terms after `v=spf1`, normalised for comparison. */
export function splitSpfTerms(record: string): string[] {
  return record.trim().split(/\s+/).slice(1).filter(Boolean);
}
