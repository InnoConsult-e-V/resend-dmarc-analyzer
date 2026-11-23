/**
 * Identity keys and review decisions for sending sources. Pure and client-safe.
 *
 * A source is identified by the *service* behind it when known (so an email
 * provider's changing IP addresses stay covered) and by its IP otherwise.
 * Decisions: `approved` (it is mine), `not_mine` (what enforcement should
 * block). Everything else is `unreviewed`.
 */

export type Decision = 'approved' | 'not_mine';
export type SourceReview = 'approved' | 'not_mine' | 'unreviewed';

export interface ServiceInfo {
  name: string;
  type: string;
  /** Which identity matched: the PTR name, a DKIM/SPF domain or the envelope-from. */
  via: 'ptr' | 'dkim' | 'spf' | 'envelope';
  domain: string;
}

export interface DecisionRecord {
  decision: Decision;
  label?: string;
  note?: string;
  decidedAt: string;
}

export type Decisions = Record<string, DecisionRecord>;

export const MAX_LABEL = 80;
export const MAX_NOTE = 280;
export const MAX_DECISIONS = 5000;
export const MAX_BULK = 200;

const KEY = /^(svc|ip):[a-z0-9 ._:-]{1,120}$/;

export function isValidKey(key: unknown): key is string {
  return typeof key === 'string' && KEY.test(key);
}

export function serviceKey(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 100)
    .trim();
  return `svc:${slug || 'unknown'}`;
}

export function ipKey(ip: string): string {
  return `ip:${ip.trim().toLowerCase()}`;
}

/** Keys to look a source up by, most specific first (service, then IP). */
export function keysFor(
  ip: string,
  service: Pick<ServiceInfo, 'name'> | null,
): string[] {
  return service ? [serviceKey(service.name), ipKey(ip)] : [ipKey(ip)];
}

/** The key a new decision is stored under. */
export function primaryKey(
  ip: string,
  service: Pick<ServiceInfo, 'name'> | null,
): string {
  return keysFor(ip, service)[0];
}

export function reviewOf(
  ip: string,
  service: Pick<ServiceInfo, 'name'> | null,
  decisions: Decisions,
): SourceReview {
  for (const key of keysFor(ip, service)) {
    const d = decisions[key];
    if (d) {
      return d.decision;
    }
  }
  return 'unreviewed';
}

export type DecisionInput =
  | {
      ok: true;
      keys: string[];
      decision: Decision | 'clear';
      label?: string;
      note?: string;
    }
  | { ok: false; error: string };

function cleanText(value: unknown, max: number): string | undefined | null {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string') {
    return null;
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return text.length > max ? null : text || undefined;
}

/** Validate a POST body for /api/senders (single key or a bulk list). */
export function validateDecisionInput(body: unknown): DecisionInput {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Invalid request' };
  }
  const b = body as Record<string, unknown>;
  const decision = b.decision;
  if (
    decision !== 'approved' &&
    decision !== 'not_mine' &&
    decision !== 'clear'
  ) {
    return { ok: false, error: 'decision must be approved, not_mine or clear' };
  }

  let keys: unknown[];
  if (Array.isArray(b.keys)) {
    keys = b.keys;
  } else if (b.key !== undefined) {
    keys = [b.key];
  } else {
    return { ok: false, error: 'key or keys is required' };
  }
  if (keys.length === 0 || keys.length > MAX_BULK) {
    return { ok: false, error: `Provide 1 to ${MAX_BULK} keys` };
  }
  if (!keys.every(isValidKey)) {
    return { ok: false, error: 'Invalid key' };
  }

  const label = cleanText(b.label, MAX_LABEL);
  const note = cleanText(b.note, MAX_NOTE);
  if (label === null) {
    return {
      ok: false,
      error: `label must be text of at most ${MAX_LABEL} characters`,
    };
  }
  if (note === null) {
    return {
      ok: false,
      error: `note must be text of at most ${MAX_NOTE} characters`,
    };
  }
  return {
    ok: true,
    keys: [...new Set(keys as string[])],
    decision,
    label,
    note,
  };
}
