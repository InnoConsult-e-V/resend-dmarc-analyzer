import 'server-only';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getStateDir } from '@/lib/config';

/**
 * Small local state: when the mailbox was last synced and when the admin last
 * marked the dashboard as reviewed. Stored as JSON (dir 0700, file 0600).
 * Clearing the folder just resets these two timestamps.
 */

export interface AppState {
  lastSyncAt?: string;
  reviewedAt?: string;
}

const KEYS: Array<keyof AppState> = ['lastSyncAt', 'reviewedAt'];

function file(): string {
  return path.resolve(process.cwd(), getStateDir(), 'app.json');
}

function validIso(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

export async function readState(): Promise<AppState> {
  try {
    const raw = JSON.parse(await readFile(file(), 'utf-8')) as AppState;
    const state: AppState = {};
    for (const key of KEYS) {
      if (validIso(raw?.[key])) {
        state[key] = raw[key];
      }
    }
    return state;
  } catch {
    return {};
  }
}

// Serialise writes so a sync and a review can't clobber each other.
let queue: Promise<unknown> = Promise.resolve();

export function updateState(patch: AppState): Promise<AppState> {
  const run = async (): Promise<AppState> => {
    const next = { ...(await readState()), ...patch };
    const f = file();
    const dir = path.dirname(f);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const tmp = path.join(dir, `.${randomBytes(8).toString('hex')}.tmp`);
    await writeFile(tmp, JSON.stringify(next), { mode: 0o600 });
    await rename(tmp, f);
    return next;
  };
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}
