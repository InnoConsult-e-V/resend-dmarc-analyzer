import type { Readiness } from './readiness';

/**
 * Policy change planner: given the live DMARC record and the readiness result,
 * propose the exact record to publish next. Pure (no I/O).
 *
 * Only `p`, `pct`, `t` and `np` are ever changed; every other tag (rua, ruf,
 * adkim, aspf, fo, sp, ...) and the tag order are preserved.
 *
 * Ramp-up reasoning: DMARCbis (RFC 9989) removed `pct` and has no partial
 * enforcement, only `t=y` (testing: the policy is not applied). Older receivers
 * ignore `t` and still honour `pct`. So `pct=25; t=y` is cautious for both:
 * 25% enforcement for older receivers, test mode for newer ones.
 */

export interface TagChange {
  tag: string;
  from: string | null;
  to: string | null;
}

export interface PlanStep {
  title: string;
  /** When to publish this step. */
  when: string;
  /** The full TXT value to publish. */
  record: string;
  changes: TagChange[];
}

export interface ChangePlan {
  /** DNS name of the TXT record, e.g. `_dmarc.example.com` */
  host: string;
  current: string | null;
  steps: PlanStep[];
  /** Why there are no steps, or advice that applies to all of them. */
  notes: string[];
}

type Tags = Array<[string, string]>;

const COMMON_NOTES = [
  'Publish it as a TXT record at the host above and keep the TTL at an hour or less while you are changing the policy, so a mistake is quick to undo.',
];
const SUBDOMAIN_NOTE =
  'If you send mail from subdomains, check them first: sp= (or p= if sp is absent) applies to them.';
const BIS_NOTE =
  'DMARCbis receivers ignore pct and treat t=y as test mode; older receivers ignore t and apply pct. The steps below are cautious for both.';

export function parseRecordTags(record: string): Tags {
  return record
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part): [string, string] => {
      const i = part.indexOf('=');
      return i > 0
        ? [part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim()]
        : [part.toLowerCase(), ''];
    });
}

export function recordFromTags(tags: Tags): string {
  return tags.map(([k, v]) => `${k}=${v}`).join('; ');
}

const get = (tags: Tags, tag: string) => tags.find(([k]) => k === tag)?.[1];

/** Set a tag, inserting it right after `after` (or at the end) when new. */
function setTag(tags: Tags, tag: string, value: string, after?: string): Tags {
  if (tags.some(([k]) => k === tag)) {
    return tags.map(([k, v]) => (k === tag ? [k, value] : [k, v]));
  }
  const out = [...tags];
  const idx = after ? out.findIndex(([k]) => k === after) : -1;
  out.splice(idx >= 0 ? idx + 1 : out.length, 0, [tag, value]);
  return out;
}

function removeTag(tags: Tags, tag: string): Tags {
  return tags.filter(([k]) => k !== tag);
}

function diffTags(before: Tags, after: Tags): TagChange[] {
  const names = [
    ...new Set([...before.map(([k]) => k), ...after.map(([k]) => k)]),
  ];
  return names
    .filter((n) => get(before, n) !== get(after, n))
    .map((tag) => ({
      tag,
      from: get(before, tag) ?? null,
      to: get(after, tag) ?? null,
    }));
}

function step(
  title: string,
  when: string,
  before: Tags,
  after: Tags,
): PlanStep {
  return {
    title,
    when,
    record: recordFromTags(after),
    changes: diffTags(before, after),
  };
}

/** Cautious first step towards `target`: partial enforcement plus test mode. */
function cautious(tags: Tags, target: 'quarantine' | 'reject'): Tags {
  let t = setTag(tags, 'p', target);
  t = setTag(t, 'pct', '25', 'p');
  return setTag(t, 't', 'y', 'pct');
}

/** Full enforcement: drop the ramp-up tags. */
function full(tags: Tags, target: 'quarantine' | 'reject'): Tags {
  return removeTag(removeTag(setTag(tags, 'p', target), 'pct'), 't');
}

/**
 * `liveRecord`: the current DMARC TXT value, `null` when there is none, and
 * `undefined` when it is unknown (the DNS lookup failed): no plan is made then.
 */
export function planNextChange(
  domain: string,
  liveRecord: string | null | undefined,
  readiness: Readiness,
): ChangePlan | null {
  if (liveRecord === undefined) {
    return null;
  }
  const host = `_dmarc.${domain}`;

  // No DMARC record yet: start in monitoring mode.
  if (liveRecord === null) {
    const starter: Tags = [
      ['v', 'DMARC1'],
      ['p', 'none'],
      ['rua', 'mailto:<your-report-address>'],
    ];
    return {
      host,
      current: null,
      steps: [step('Publish a monitoring-only record', 'Now', [], starter)],
      notes: [
        ...COMMON_NOTES,
        'Replace <your-report-address> with the mailbox that receives your reports. p=none blocks nothing; it only starts the reports.',
      ],
    };
  }

  const tags = parseRecordTags(liveRecord);
  const declared = (get(tags, 'p') ?? 'none').toLowerCase();
  const testing = (get(tags, 't') ?? '').toLowerCase() === 'y';
  const pct = Number(get(tags, 'pct'));
  const pctPartial =
    get(tags, 'pct') !== undefined && Number.isFinite(pct) && pct < 100;

  const blockers = readiness.checks.filter(
    (c) => c.severity === 'warn' || c.severity === 'error',
  );
  const onlyPct = blockers.length > 0 && blockers.every((c) => c.id === 'pct');
  const plan = (steps: PlanStep[], notes: string[] = []): ChangePlan => ({
    host,
    current: liveRecord,
    steps,
    notes,
  });

  // Not in a position to tighten: say why instead of proposing a record.
  const canProceed =
    readiness.status === 'ready' ||
    readiness.status === 'enforced' ||
    (readiness.status === 'almost' && onlyPct);
  if (!canProceed) {
    return plan([], [`No change recommended yet. ${readiness.nextStep}`]);
  }

  // Legacy ramp-up in progress: raise pct step by step.
  if (declared !== 'none' && pctPartial && !testing) {
    const next = pct < 50 ? 50 : 100;
    return plan(
      [
        step(
          next === 100 ? 'Apply to all mail' : `Raise pct to ${next}`,
          'After another clean week of reports',
          tags,
          next === 100
            ? removeTag(tags, 'pct')
            : setTag(tags, 'pct', String(next)),
        ),
      ],
      [...COMMON_NOTES, BIS_NOTE],
    );
  }

  // Test mode (t=y) with the checks passing: switch it off to enforce.
  if (declared !== 'none' && testing) {
    return plan(
      [
        step(
          `Enforce p=${declared}`,
          'Now, then watch the next reports',
          tags,
          removeTag(removeTag(tags, 't'), 'pct'),
        ),
      ],
      [...COMMON_NOTES, SUBDOMAIN_NOTE],
    );
  }

  if (declared === 'none') {
    return plan(
      [
        step(
          'Start enforcing cautiously (quarantine)',
          'Now',
          tags,
          cautious(tags, 'quarantine'),
        ),
        step(
          'Quarantine all failing mail',
          'After one to two weeks of clean reports',
          cautious(tags, 'quarantine'),
          full(tags, 'quarantine'),
        ),
      ],
      [...COMMON_NOTES, BIS_NOTE, SUBDOMAIN_NOTE],
    );
  }

  if (declared === 'quarantine') {
    return plan(
      [
        step(
          'Start rejecting cautiously',
          'Now',
          tags,
          cautious(tags, 'reject'),
        ),
        step(
          'Reject all failing mail',
          'After one to two weeks of clean reports',
          cautious(tags, 'reject'),
          full(tags, 'reject'),
        ),
      ],
      [...COMMON_NOTES, BIS_NOTE, SUBDOMAIN_NOTE],
    );
  }

  // Fully enforced: optional hardening for subdomains that do not exist.
  if (get(tags, 'np') === undefined) {
    return plan(
      [
        step(
          'Optional: reject mail from non-existent subdomains',
          'Any time',
          tags,
          setTag(
            tags,
            'np',
            'reject',
            get(tags, 'sp') !== undefined ? 'sp' : 'p',
          ),
        ),
      ],
      [
        ...COMMON_NOTES,
        'np= (DMARCbis) sets the policy for subdomains that do not exist in DNS. Older receivers ignore it.',
      ],
    );
  }
  return plan(
    [],
    ['Your policy is fully enforced and np= is set. Nothing to change.'],
  );
}
