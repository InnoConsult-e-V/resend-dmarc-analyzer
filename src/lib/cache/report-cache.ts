import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import {
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { getCacheConfig } from '@/lib/config';
import { reviveAnalysis } from '@/lib/dmarc/revive';
import type { DMARCAnalysis } from '@/types/dmarc';

/**
 * Simple on-disk cache of parsed reports, one JSON file per attachment.
 *
 * Contains report data (domains, source IPs) in plain text, so the directory
 * is created 0700 and files 0600. Any failure is treated as a cache miss:
 * caching must never break a fetch. Nothing sensitive is logged.
 */

const VERSION = 1;

export interface CacheEntry {
  version: number;
  cachedAt: number;
  subject: string;
  receivedDateTime: string;
  analysis: DMARCAnalysis;
}

/** Build a cache key from Graph IDs. Hashed so IDs never touch the filesystem. */
export function cacheKey(messageId: string, attachmentId: string): string {
  return createHash('sha256')
    .update(`${messageId}:${attachmentId}`)
    .digest('hex');
}

function cacheDir(): string {
  return path.resolve(process.cwd(), getCacheConfig().dir);
}

function fileFor(key: string): string {
  return path.join(cacheDir(), `${key}.json`);
}

function isEntry(value: unknown): value is CacheEntry {
  const v = value as CacheEntry | null;
  return (
    !!v &&
    v.version === VERSION &&
    typeof v.cachedAt === 'number' &&
    typeof v.subject === 'string' &&
    typeof v.receivedDateTime === 'string' &&
    !!v.analysis?.report &&
    !!v.analysis.summary &&
    !!v.analysis.dateRange
  );
}

export async function getCached(key: string): Promise<CacheEntry | null> {
  const file = fileFor(key);
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf-8'));
    if (!isEntry(parsed)) {
      await unlink(file).catch(() => {});
      return null;
    }
    if (Date.now() - parsed.cachedAt > getCacheConfig().ttlMs) {
      await unlink(file).catch(() => {});
      return null;
    }
    return { ...parsed, analysis: reviveAnalysis(parsed.analysis) };
  } catch {
    return null;
  }
}

export async function setCached(
  key: string,
  data: Omit<CacheEntry, 'version' | 'cachedAt'>,
): Promise<void> {
  try {
    const dir = cacheDir();
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const entry: CacheEntry = {
      version: VERSION,
      cachedAt: Date.now(),
      ...data,
    };
    const tmp = path.join(dir, `.${randomBytes(8).toString('hex')}.tmp`);
    await writeFile(tmp, JSON.stringify(entry), { mode: 0o600 });
    await rename(tmp, fileFor(key));
    await pruneCache();
  } catch {
    console.warn('[cache] could not write cache entry');
  }
}

/**
 * All valid, unexpired cache entries, newest report first. Used to show
 * previously fetched reports at startup without calling Graph.
 */
export async function listCached(): Promise<CacheEntry[]> {
  try {
    const { ttlMs } = getCacheConfig();
    const dir = cacheDir();
    const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
    const now = Date.now();
    const entries = await Promise.all(
      files.map(async (f): Promise<CacheEntry | null> => {
        try {
          const parsed: unknown = JSON.parse(
            await readFile(path.join(dir, f), 'utf-8'),
          );
          if (!isEntry(parsed) || now - parsed.cachedAt > ttlMs) {
            return null;
          }
          return parsed;
        } catch {
          return null;
        }
      }),
    );
    return entries
      .filter((e): e is CacheEntry => e !== null)
      .sort((a, b) => b.receivedDateTime.localeCompare(a.receivedDateTime));
  } catch {
    return [];
  }
}

/** Delete expired entries, then the oldest ones beyond the size cap. */
export async function pruneCache(): Promise<void> {
  try {
    const { ttlMs, maxEntries } = getCacheConfig();
    const dir = cacheDir();
    const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
    const info = await Promise.all(
      files.map(async (f) => ({
        file: path.join(dir, f),
        mtime: (await stat(path.join(dir, f))).mtimeMs,
      })),
    );
    info.sort((a, b) => b.mtime - a.mtime);
    const now = Date.now();
    await Promise.all(
      info
        .filter((e, i) => i >= maxEntries || now - e.mtime > ttlMs)
        .map((e) => unlink(e.file).catch(() => {})),
    );
  } catch {
    // ignore: pruning is best-effort
  }
}
