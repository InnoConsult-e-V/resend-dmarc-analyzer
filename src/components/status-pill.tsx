'use client';

export type HealthState =
  | { status: 'checking'; detail: string }
  | { status: 'ok'; detail: string }
  | { status: 'signed_out'; detail: string }
  | { status: 'not_configured'; detail: string }
  | { status: 'error'; detail: string };

const STYLES: Record<
  HealthState['status'],
  { label: string; pill: string; dot: string }
> = {
  checking: {
    label: 'Checking…',
    pill: 'bg-gray-3 text-gray-7',
    dot: 'bg-gray-6 animate-pulse',
  },
  ok: {
    label: 'Operational',
    pill: 'bg-green-dim text-green',
    dot: 'bg-green',
  },
  signed_out: {
    label: 'Sign-in required',
    pill: 'bg-yellow-dim text-yellow',
    dot: 'bg-yellow',
  },
  not_configured: {
    label: 'Not configured',
    pill: 'bg-red-dim text-red',
    dot: 'bg-red',
  },
  error: { label: 'Issue', pill: 'bg-red-dim text-red', dot: 'bg-red' },
};

interface StatusPillProps {
  health: HealthState;
  onRecheck: () => void;
}

export function StatusPill({ health, onRecheck }: StatusPillProps) {
  const style = STYLES[health.status];
  return (
    <button
      type="button"
      onClick={onRecheck}
      title={`${health.detail} (click to re-check)`}
      aria-label={`System status: ${style.label}. ${health.detail}`}
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium transition-opacity hover:opacity-80 ${style.pill}`}
    >
      <span className={`h-2 w-2 rounded-full ${style.dot}`} />
      {style.label}
    </button>
  );
}
