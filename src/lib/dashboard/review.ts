import type { SourceReview } from '@/lib/senders/keys';

/**
 * What is known about each sending source for review purposes: whether the
 * admin approved it or marked it "not mine", and which service it was
 * identified as. Pure data, so the logic that uses it stays testable.
 */
export interface ReviewContext {
  reviewByIp: Record<string, SourceReview>;
  serviceByIp: Record<string, { name: string; type: string } | null>;
}

export const NO_REVIEW: ReviewContext = { reviewByIp: {}, serviceByIp: {} };

export function reviewFor(
  ctx: ReviewContext | undefined,
  ip: string,
): SourceReview {
  return ctx?.reviewByIp[ip] ?? 'unreviewed';
}

export function serviceNameFor(
  ctx: ReviewContext | undefined,
  ip: string,
): string | null {
  return ctx?.serviceByIp[ip]?.name ?? null;
}
