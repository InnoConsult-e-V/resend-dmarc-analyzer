/**
 * Pure helpers for the sender-name map (parsedmarc's base_reverse_dns_map.csv):
 * an RFC 4180 CSV parser and a strict validator. Used by the loader and by the
 * refresh script, so a bad download can never be vendored.
 */

export interface NameMapRow {
  /** Base reverse-DNS domain, lower case */
  domain: string;
  name: string;
  type: string;
}

export const NAME_MAP_HEADER = ['base_reverse_dns', 'name', 'type'];
export const NAME_MAP_MAX_BYTES = 5 * 1024 * 1024;
const MIN_ROWS = 1000;
const MAX_ROWS = 200_000;
/** Allow a few odd upstream rows, but not a broken file. */
const MAX_BAD_ROW_SHARE = 0.005;

/** RFC 4180: quoted fields may contain commas, quotes ("") and newlines. */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') {
        i++;
      }
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') {
        rows.push(row);
      }
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const DOMAIN = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;
// A reverse-DNS key containing a full IPv4 address would be personal data.
const IPV4_LIKE = /(\d{1,3}[.-]){3}\d{1,3}/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting them is the point
const CONTROL = /[\u0000-\u001f\u007f]/;

function rowProblem(r: string[]): string | null {
  if (r.length !== 3) {
    return `expected 3 columns, got ${r.length}`;
  }
  const [rawDomain, name, type] = r;
  const domain = rawDomain.toLowerCase();
  if (!DOMAIN.test(domain)) {
    return `bad domain "${domain.slice(0, 40)}"`;
  }
  if (IPV4_LIKE.test(domain)) {
    return `domain looks like an IP address "${domain}"`;
  }
  if (name.length < 1 || name.length > 200 || CONTROL.test(name)) {
    return `bad name for ${domain}`;
  }
  if (type.length > 60 || CONTROL.test(type)) {
    return `bad type for ${domain}`;
  }
  return null;
}

export type NameMapResult =
  | { ok: true; rows: NameMapRow[]; skipped: number }
  | { ok: false; error: string };

export function validateNameMap(text: string): NameMapResult {
  if (text.length > NAME_MAP_MAX_BYTES) {
    return { ok: false, error: 'file is larger than 5 MB' };
  }
  const table = parseCsv(text);
  const header = table[0]?.map((h) => h.trim());
  if (!header || header.join(',') !== NAME_MAP_HEADER.join(',')) {
    return {
      ok: false,
      error: `unexpected header "${header?.join(',') ?? ''}" (expected ${NAME_MAP_HEADER.join(',')})`,
    };
  }
  const body = table.slice(1);
  if (body.length < MIN_ROWS) {
    return { ok: false, error: `only ${body.length} rows (looks truncated)` };
  }
  if (body.length > MAX_ROWS) {
    return { ok: false, error: `${body.length} rows (more than ${MAX_ROWS})` };
  }

  const rows: NameMapRow[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const r of body) {
    const problem = rowProblem(r);
    if (problem) {
      problems.push(problem);
      continue;
    }
    const domain = r[0].toLowerCase();
    if (seen.has(domain)) {
      continue; // keep the first mapping for a domain
    }
    seen.add(domain);
    rows.push({ domain, name: r[1].trim(), type: r[2].trim() });
  }
  if (problems.length / body.length > MAX_BAD_ROW_SHARE) {
    return {
      ok: false,
      error: `${problems.length} of ${body.length} rows are invalid, e.g. ${problems.slice(0, 3).join('; ')}`,
    };
  }
  return { ok: true, rows, skipped: problems.length };
}
