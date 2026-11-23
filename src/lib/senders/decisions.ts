import 'server-only';
import { readData, updateData } from '@/lib/data/store';
import {
  type Decision,
  type DecisionRecord,
  type Decisions,
  MAX_DECISIONS,
} from './keys';

const FILE = 'senders.json';

export async function readDecisions(): Promise<Decisions> {
  const data = await readData<Decisions>(FILE, {});
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

/** Apply a decision (or clear it) to one or more keys. */
export async function applyDecision(
  keys: string[],
  decision: Decision | 'clear',
  extra: { label?: string; note?: string } = {},
  now: Date = new Date(),
): Promise<Decisions> {
  return updateData<Decisions>(FILE, {}, (current) => {
    const next: Decisions = { ...current };
    for (const key of keys) {
      if (decision === 'clear') {
        delete next[key];
      } else {
        const record: DecisionRecord = {
          decision,
          decidedAt: now.toISOString(),
          ...(extra.label ? { label: extra.label } : {}),
          ...(extra.note ? { note: extra.note } : {}),
        };
        next[key] = record;
      }
    }
    if (Object.keys(next).length > MAX_DECISIONS) {
      throw new Error('Too many saved decisions');
    }
    return next;
  });
}
