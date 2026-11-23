/**
 * Refresh the vendored sender-name map from parsedmarc.
 *
 *   pnpm update:senders
 *
 * Downloads one fixed file, validates it strictly, and only then replaces
 * data/sender-names/base_reverse_dns_map.csv and updates NOTICE.md. A failed
 * download or validation leaves the existing files untouched. Review the
 * result with `git diff --stat`.
 */

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NAME_MAP_MAX_BYTES, validateNameMap } from '../src/lib/senders/csv';

export const SOURCE_URL =
  'https://raw.githubusercontent.com/domainaware/parsedmarc/master/parsedmarc/resources/maps/base_reverse_dns_map.csv';
const DEFAULT_DIR = path.resolve(process.cwd(), 'data/sender-names');
const CSV_NAME = 'base_reverse_dns_map.csv';

export interface RefreshSummary {
  rows: number;
  skipped: number;
  previousRows: number | null;
  added: string[];
  removed: string[];
  sha256: string;
}

async function atomicWrite(file: string, content: string): Promise<void> {
  const tmp = path.join(
    path.dirname(file),
    `.${randomBytes(6).toString('hex')}.tmp`,
  );
  await writeFile(tmp, content);
  await rename(tmp, file);
}

function notice(summary: RefreshSummary, retrieved: string): string {
  return `# Sender-name data

\`${CSV_NAME}\` maps the base domain of a sending server's reverse DNS (or a DKIM, SPF or envelope-from domain) to the name and type of the organisation behind it. The app uses it to label sending sources, for example "Intuit Mailchimp (Marketing)".

- Source: https://github.com/domainaware/parsedmarc (\`parsedmarc/resources/maps/${CSV_NAME}\`)
- Retrieved: ${retrieved}
- Rows: ${summary.rows.toLocaleString('en-US')} (SHA-256 ${summary.sha256})
- Refresh: \`pnpm update:senders\`

## Licence

This data file is distributed under the **Creative Commons Attribution-ShareAlike 4.0 International** licence (CC BY-SA 4.0, https://creativecommons.org/licenses/by-sa/4.0/), as stated by the parsedmarc project, because many entries derive from IPinfo Lite data.

Attribution: the [parsedmarc](https://github.com/domainaware/parsedmarc) project (domainaware) and [IPinfo](https://ipinfo.io/) for the underlying network identification data.

If you redistribute or adapt this file, the same licence applies to it. This licence covers this data file only; the rest of the repository is under its own licence (see the top-level LICENSE).
`;
}

/** Download, validate and install the map. Throws on any problem (files untouched). */
export async function refreshSenderNames(
  options: { dir?: string; fetchImpl?: typeof fetch; now?: Date } = {},
): Promise<RefreshSummary> {
  const dir = options.dir ?? DEFAULT_DIR;
  const doFetch = options.fetchImpl ?? fetch;
  const csvFile = path.join(dir, CSV_NAME);

  const res = await doFetch(SOURCE_URL, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`Download failed: HTTP ${res.status}`);
  }
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > NAME_MAP_MAX_BYTES) {
    throw new Error('Download is larger than 5 MB');
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > NAME_MAP_MAX_BYTES) {
    throw new Error('Download is larger than 5 MB');
  }
  const text = bytes.toString('utf-8');

  const result = validateNameMap(text);
  if (!result.ok) {
    throw new Error(`Validation failed: ${result.error}`);
  }

  let before: Set<string> | null = null;
  if (existsSync(csvFile)) {
    const old = validateNameMap(readFileSync(csvFile, 'utf-8'));
    before = old.ok ? new Set(old.rows.map((r) => r.domain)) : null;
  }
  const after = new Set(result.rows.map((r) => r.domain));
  const summary: RefreshSummary = {
    rows: result.rows.length,
    skipped: result.skipped,
    previousRows: before?.size ?? null,
    added: before ? [...after].filter((d) => !before.has(d)) : [],
    removed: before ? [...before].filter((d) => !after.has(d)) : [],
    sha256: createHash('sha256').update(bytes).digest('hex').slice(0, 16),
  };

  await mkdir(dir, { recursive: true });
  // Keep the upstream bytes exactly; the loader skips the few invalid rows.
  await atomicWrite(csvFile, text);
  await atomicWrite(
    path.join(dir, 'NOTICE.md'),
    notice(summary, (options.now ?? new Date()).toISOString().slice(0, 10)),
  );
  return summary;
}

async function main() {
  try {
    const s = await refreshSenderNames();
    console.log(
      `Updated data/sender-names (${s.rows.toLocaleString('en-US')} rows, sha256 ${s.sha256}).`,
    );
    if (s.previousRows !== null) {
      console.log(
        `Previously ${s.previousRows.toLocaleString('en-US')} rows: ${s.added.length} added, ${s.removed.length} removed.`,
      );
    }
    if (s.skipped > 0) {
      console.log(
        `${s.skipped} invalid upstream row(s) are skipped when loading.`,
      );
    }
    console.log('Review with: git diff --stat data/sender-names');
  } catch (err) {
    console.error(
      `Sender-name refresh failed; existing files are unchanged.\n${err instanceof Error ? err.message : err}`,
    );
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith('update-sender-names.ts')) {
  main();
}
