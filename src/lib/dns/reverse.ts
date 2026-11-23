import 'server-only';
import { randomBytes } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { isIPv6 } from 'node:net';
import path from 'node:path';
import { getDomain } from 'tldts';
import { getDnsCacheDir } from '@/lib/config';

/**
 * Reverse DNS (PTR) lookups for sending IPs, forward-confirmed. Uses only the
 * machine's own resolver (no third-party services) and caches results on disk
 * for a week so repeat views don't re-query.
 */

export interface PtrResolverLike {
  reverse(ip: string): Promise<string[]>;
  resolve4(host: string): Promise<string[]>;
  resolve6(host: string): Promise<string[]>;
}

export interface PtrInfo {
  ip: string;
  ptr: string | null;
  /** Forward-confirmed: the PTR name resolves back to the same IP. */
  verified: boolean;
  /** Registrable domain of the PTR name (the sending organisation). */
  org: string | null;
}

export const MAX_IPS_PER_REQUEST = 100;
const CONCURRENCY = 8;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface CacheRow extends PtrInfo {
  at: number;
}

function defaultResolver(): PtrResolverLike {
  return new Resolver({ timeout: 2000, tries: 1 });
}

function normalizeIp(ip: string): string {
  if (isIPv6(ip)) {
    try {
      return new URL(`http://[${ip}]`).hostname.toLowerCase();
    } catch {
      return ip.toLowerCase();
    }
  }
  return ip;
}

async function lookupOne(
  ip: string,
  resolver: PtrResolverLike,
): Promise<PtrInfo> {
  const none: PtrInfo = { ip, ptr: null, verified: false, org: null };
  let hosts: string[];
  try {
    hosts = await resolver.reverse(ip);
  } catch {
    return none;
  }
  const ptr = hosts[0]?.replace(/\.$/, '').toLowerCase();
  if (!ptr) {
    return none;
  }

  let verified = false;
  try {
    const forward = isIPv6(ip)
      ? await resolver.resolve6(ptr)
      : await resolver.resolve4(ptr);
    verified = forward.map(normalizeIp).includes(normalizeIp(ip));
  } catch {
    // unverified
  }
  return { ip, ptr, verified, org: getDomain(ptr) ?? ptr };
}

async function readCache(file: string): Promise<Record<string, CacheRow>> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeCache(
  file: string,
  rows: Record<string, CacheRow>,
): Promise<void> {
  try {
    const dir = path.dirname(file);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const tmp = path.join(dir, `.${randomBytes(8).toString('hex')}.tmp`);
    await writeFile(tmp, JSON.stringify(rows), { mode: 0o600 });
    await rename(tmp, file);
  } catch {
    console.warn('[dns] could not write PTR cache');
  }
}

/** Reverse-DNS results that are already cached (fresh), without any network lookup. */
export async function cachedPtrs(
  ips: string[],
  now: number = Date.now(),
): Promise<Record<string, PtrInfo>> {
  const file = path.resolve(process.cwd(), getDnsCacheDir(), 'ptr.json');
  const cache = await readCache(file);
  const out: Record<string, PtrInfo> = {};
  for (const ip of ips) {
    const hit = cache[ip];
    if (hit && now - hit.at < TTL_MS) {
      out[ip] = { ip, ptr: hit.ptr, verified: hit.verified, org: hit.org };
    }
  }
  return out;
}

export async function reverseLookup(
  ips: string[],
  resolver: PtrResolverLike = defaultResolver(),
  now: number = Date.now(),
): Promise<PtrInfo[]> {
  const unique = [...new Set(ips)].slice(0, MAX_IPS_PER_REQUEST);
  const file = path.resolve(process.cwd(), getDnsCacheDir(), 'ptr.json');
  const cache = await readCache(file);

  const results = new Map<string, PtrInfo>();
  const todo: string[] = [];
  for (const ip of unique) {
    const hit = cache[ip];
    if (hit && now - hit.at < TTL_MS) {
      results.set(ip, {
        ip,
        ptr: hit.ptr,
        verified: hit.verified,
        org: hit.org,
      });
    } else {
      todo.push(ip);
    }
  }

  // Small worker pool.
  const queue = [...todo];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let ip = queue.shift(); ip; ip = queue.shift()) {
        const info = await lookupOne(ip, resolver);
        results.set(ip, info);
        cache[ip] = { ...info, at: now };
      }
    }),
  );

  if (todo.length > 0) {
    await writeCache(file, cache);
  }
  return unique.map((ip) => results.get(ip) as PtrInfo);
}
