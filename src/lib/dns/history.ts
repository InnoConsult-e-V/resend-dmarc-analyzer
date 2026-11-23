import 'server-only';
import { readData, updateData } from '@/lib/data/store';
import type { DomainDnsReport } from './records';
import {
  type DnsChangeLine,
  type DnsSnapshot,
  diffSnapshots,
} from './snapshot';

export type { DnsChangeLine, DnsSnapshot } from './snapshot';
export { diffSnapshots, snapshotOf } from './snapshot';

const FILE = 'dns-history.json';
const MAX_ENTRIES_PER_DOMAIN = 100;

export interface DnsHistoryEntry {
  /** ISO time the change was first seen */
  at: string;
  snapshot: DnsSnapshot;
  /** What changed versus the previous entry; empty for the first (baseline) entry. */
  changes: DnsChangeLine[];
  baseline?: boolean;
}

type HistoryFile = Record<string, DnsHistoryEntry[]>;

export async function readHistory(): Promise<HistoryFile> {
  const data = await readData<HistoryFile>(FILE, {});
  return data && typeof data === 'object' ? data : {};
}

/**
 * Record the current DNS state of a domain. Writes only when something changed
 * (the first call stores a baseline). A report with failed lookups is skipped
 * so a DNS timeout never shows up as "record removed".
 */
export async function recordSnapshot(
  report: DomainDnsReport,
  snapshot: DnsSnapshot,
  now: Date = new Date(),
): Promise<{ recorded: boolean; skipped: boolean; changes: DnsChangeLine[] }> {
  if (snapshot.incomplete) {
    return { recorded: false, skipped: true, changes: [] };
  }
  let result: { recorded: boolean; changes: DnsChangeLine[] } = {
    recorded: false,
    changes: [],
  };
  await updateData<HistoryFile>(FILE, {}, (current) => {
    const list = current[report.domain] ?? [];
    const last = list[list.length - 1];
    if (!last) {
      result = { recorded: true, changes: [] };
      return {
        ...current,
        [report.domain]: [
          { at: now.toISOString(), snapshot, changes: [], baseline: true },
        ],
      };
    }
    const changes = diffSnapshots(last.snapshot, snapshot);
    if (changes.length === 0) {
      return current;
    }
    result = { recorded: true, changes };
    return {
      ...current,
      [report.domain]: [
        ...list,
        { at: now.toISOString(), snapshot, changes },
      ].slice(-MAX_ENTRIES_PER_DOMAIN),
    };
  });
  return { ...result, skipped: false };
}
