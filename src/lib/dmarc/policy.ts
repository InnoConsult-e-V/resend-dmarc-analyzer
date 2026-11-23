import type { DispositionType, PolicyPublished } from '@/types/dmarc';

/**
 * Helpers for a published DMARC policy that work for both the original
 * (RFC 7489) and the revised (DMARCbis, RFC 9989/9990) formats: `pct` is gone
 * in the revision, `t=y` (testing) means the policy is not applied, and
 * `sp`, `adkim`, `aspf` are optional.
 */

/** The parts of a published policy the app reasons about. */
export type PublishedPolicy = Pick<PolicyPublished, 'p'> &
  Partial<Pick<PolicyPublished, 'sp' | 'np' | 'pct' | 'testing'>>;

type PolicyLike = PublishedPolicy;

export interface EffectivePolicy {
  /** What receivers actually apply: `none` while in test mode. */
  stage: DispositionType;
  /** The declared `p=` value. */
  declared: DispositionType;
  testing: boolean;
  /** Share of failing mail the policy applies to, 0..100. */
  pctApplied: number;
}

export function effectivePolicy(policy: PolicyLike): EffectivePolicy {
  const testing = policy.testing === 'y';
  const pct =
    typeof policy.pct === 'number' && Number.isFinite(policy.pct)
      ? policy.pct
      : 100;
  return {
    stage: testing ? 'none' : policy.p,
    declared: policy.p,
    testing,
    pctApplied: testing ? 0 : pct,
  };
}

/** `p=quarantine · sp=none · pct=25 · testing`, showing only tags that exist. */
export function formatPolicy(policy: PolicyLike | null | undefined): string {
  if (!policy) {
    return 'no policy seen';
  }
  const parts = [`p=${policy.p}`];
  if (policy.sp) {
    parts.push(`sp=${policy.sp}`);
  }
  if (policy.np) {
    parts.push(`np=${policy.np}`);
  }
  if (typeof policy.pct === 'number' && Number.isFinite(policy.pct)) {
    parts.push(`pct=${policy.pct}`);
  }
  if (policy.testing === 'y') {
    parts.push('testing');
  }
  return parts.join(' · ');
}

/** Pick the policy fields the app uses from a report's `policy_published`. */
export function publishedOf(policy: PolicyPublished): PublishedPolicy {
  return {
    p: policy.p,
    sp: policy.sp,
    np: policy.np,
    pct: policy.pct,
    testing: policy.testing,
  };
}

/** Display strings for a report's published policy, handling absent fields. */
export function describePolicyFields(policy: PolicyPublished) {
  return {
    sp: policy.sp ?? 'Same as p',
    np: policy.np ?? null,
    adkim:
      policy.adkim === 's'
        ? 'Strict'
        : policy.adkim === 'r'
          ? 'Relaxed'
          : 'Relaxed (default)',
    aspf:
      policy.aspf === 's'
        ? 'Strict'
        : policy.aspf === 'r'
          ? 'Relaxed'
          : 'Relaxed (default)',
    pct:
      typeof policy.pct === 'number' && Number.isFinite(policy.pct)
        ? `${policy.pct}%`
        : 'Not set (100%)',
    testing:
      policy.testing === 'y'
        ? 'Yes: policy is not applied'
        : policy.testing === 'n'
          ? 'No'
          : null,
  };
}
