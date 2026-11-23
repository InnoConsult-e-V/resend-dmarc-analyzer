import 'server-only';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getDataDir } from '@/lib/config';

/**
 * Tiny JSON store for the admin's own data (approved senders, DNS history).
 * Files live in the data folder (dir 0700, files 0600), are written
 * atomically, and writes are serialised so concurrent requests cannot clobber
 * each other. Reads of a missing or corrupt file return the fallback.
 */

function fileFor(name: string): string {
  if (!/^[a-z0-9-]+\.json$/.test(name)) {
    throw new Error('Invalid data file name');
  }
  return path.resolve(process.cwd(), getDataDir(), name);
}

export async function readData<T>(name: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(fileFor(name), 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Read-modify-write under a lock. `update` receives the current value; return
 * it unchanged (same object) to skip the write.
 */
export function updateData<T>(
  name: string,
  fallback: T,
  update: (current: T) => T,
): Promise<T> {
  const run = async (): Promise<T> => {
    const current = await readData(name, fallback);
    const next = update(current);
    // Returning the same object means "no change": skip the write.
    if (Object.is(next, current)) {
      return current;
    }
    const file = fileFor(name);
    const dir = path.dirname(file);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const tmp = path.join(dir, `.${randomBytes(8).toString('hex')}.tmp`);
    await writeFile(tmp, JSON.stringify(next), { mode: 0o600 });
    await rename(tmp, file);
    return next;
  };
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}
