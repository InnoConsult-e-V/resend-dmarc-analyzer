import 'server-only';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getGraphConfig } from '@/lib/config';

/**
 * Persists the delegated-auth refresh token on disk so the user stays signed
 * in across restarts. It is a credential: the directory is 0700 and the file
 * 0600, and it is never logged. Access tokens are kept in memory only.
 */

export interface StoredAuth {
  refreshToken: string;
  account: string;
  savedAt: number;
}

function authFile(): string {
  return path.resolve(process.cwd(), getGraphConfig().authDir, 'token.json');
}

export async function readAuth(): Promise<StoredAuth | null> {
  try {
    const v = JSON.parse(await readFile(authFile(), 'utf-8')) as StoredAuth;
    if (
      typeof v?.refreshToken !== 'string' ||
      !v.refreshToken ||
      typeof v.account !== 'string'
    ) {
      return null;
    }
    return v;
  } catch {
    return null;
  }
}

export async function writeAuth(auth: StoredAuth): Promise<void> {
  const file = authFile();
  const dir = path.dirname(file);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.${randomBytes(8).toString('hex')}.tmp`);
  await writeFile(tmp, JSON.stringify(auth), { mode: 0o600 });
  await rename(tmp, file);
}

export async function clearAuth(): Promise<void> {
  await unlink(authFile()).catch(() => {});
}
