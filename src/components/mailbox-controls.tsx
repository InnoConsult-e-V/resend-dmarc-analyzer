'use client';

import type { AuthState } from '@/hooks/use-mailbox';
import { formatDateTime } from '@/lib/format-date';

const STALE_DAYS = 7;
const DAY_MS = 86_400_000;

function ago(iso: string, now: number): string {
  const days = Math.floor((now - Date.parse(iso)) / DAY_MS);
  if (days <= 0) {
    return 'today';
  }
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

interface MailboxControlsProps {
  auth: AuthState;
  syncing: boolean;
  onSync: (refresh: boolean) => void;
  onSignOut: () => void;
  /** ISO time of the last successful sync; undefined hides the line (Reports page). */
  lastSyncAt?: string | null;
}

/** Manual mailbox sync, sign-in/out and when the data was last updated. */
export function MailboxControls({
  auth,
  syncing,
  onSync,
  onSignOut,
  lastSyncAt,
}: MailboxControlsProps) {
  const now = Date.now();
  const stale =
    lastSyncAt === null ||
    (lastSyncAt !== undefined &&
      now - Date.parse(lastSyncAt) > STALE_DAYS * DAY_MS);

  return (
    <section
      aria-label="Mailbox"
      className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-gray-3 bg-gray-2 px-5 py-4"
    >
      {!auth.checked ? null : auth.signedIn ? (
        <>
          <button
            type="button"
            onClick={() => onSync(false)}
            disabled={syncing}
            className="rounded-xl bg-gray-10 px-5 py-2 text-sm font-medium text-gray-1 transition-colors hover:bg-gray-9 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {syncing ? 'Syncing…' : 'Sync mailbox'}
          </button>
          <button
            type="button"
            onClick={() => onSync(true)}
            disabled={syncing}
            title="Download and re-parse every report instead of using the cache"
            className="rounded-xl border border-gray-3 px-4 py-2 text-sm text-gray-9 transition-colors hover:bg-gray-3 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Force refresh
          </button>
        </>
      ) : (
        <a
          href="/api/auth/login"
          className="rounded-xl bg-gray-10 px-5 py-2 text-sm font-medium text-gray-1 transition-colors hover:bg-gray-9"
        >
          Sign in with Microsoft
        </a>
      )}

      {lastSyncAt !== undefined && (
        <p
          className={`text-sm ${stale ? 'text-yellow' : 'text-gray-6'}`}
          title={
            stale ? 'The data may be out of date: sync the mailbox' : undefined
          }
        >
          {lastSyncAt === null ? (
            'Never synced'
          ) : (
            <>
              Last synced {formatDateTime(lastSyncAt)} ({ago(lastSyncAt, now)})
            </>
          )}
          {stale && <span className="sr-only"> (out of date)</span>}
        </p>
      )}

      {auth.checked && auth.signedIn && (
        <p className="text-sm text-gray-6 sm:ml-auto">
          Signed in as {auth.account}{' '}
          <button
            type="button"
            onClick={onSignOut}
            className="underline underline-offset-2 hover:text-gray-9"
          >
            Sign out
          </button>
        </p>
      )}
    </section>
  );
}
