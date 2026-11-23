'use client';

import type { ReadinessStatus } from '@/lib/dashboard/readiness';
import { StatusChip, type Tone } from './status-chip';

export const READINESS_LABEL: Record<
  ReadinessStatus,
  { label: string; tone: Tone }
> = {
  insufficient_data: { label: 'Not enough data', tone: 'neutral' },
  not_ready: { label: 'Not ready', tone: 'bad' },
  almost: { label: 'Almost ready', tone: 'warn' },
  ready: { label: 'Ready to tighten', tone: 'good' },
  enforced: { label: 'Enforced', tone: 'good' },
  monitoring: { label: 'Enforced, needs review', tone: 'warn' },
};

export function ReadinessChip({ status }: { status: ReadinessStatus }) {
  const { label, tone } = READINESS_LABEL[status];
  return <StatusChip tone={tone} label={label} />;
}
