'use client';

import { useState } from 'react';
import type { ChangePlan, PlanStep } from '@/lib/dashboard/planner';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for contexts without the async clipboard API.
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}

/** The record split into tags, with new or changed tags highlighted. */
function HighlightedRecord({ step }: { step: PlanStep }) {
  const changed = new Set(
    step.changes.filter((c) => c.to !== null).map((c) => c.tag),
  );
  const parts = step.record.split('; ');
  return (
    <code className="block break-all rounded-lg bg-gray-1 px-3 py-2 text-xs leading-relaxed text-gray-8">
      {parts.map((part, i) => {
        const tag = part.split('=')[0].toLowerCase();
        const isChanged = changed.has(tag);
        return (
          <span key={part}>
            {i > 0 && '; '}
            {isChanged ? (
              <mark
                className="rounded bg-yellow-dim px-0.5 text-yellow"
                title="New or changed"
              >
                {part}
              </mark>
            ) : (
              part
            )}
          </span>
        );
      })}
    </code>
  );
}

function Step({ step, index }: { step: PlanStep; index: number }) {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle');
  const removed = step.changes.filter((c) => c.to === null).map((c) => c.tag);

  async function copy() {
    const ok = await copyText(step.record);
    setCopied(ok ? 'ok' : 'failed');
    setTimeout(() => setCopied('idle'), 2500);
  }

  return (
    <li className="rounded-lg border border-gray-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-gray-10">
            {index + 1}. {step.title}
          </p>
          <p className="text-xs text-gray-6">When: {step.when}</p>
        </div>
        <button
          type="button"
          onClick={copy}
          className="rounded-lg border border-gray-3 px-3 py-1 text-xs text-gray-9 transition-colors hover:bg-gray-3"
        >
          {copied === 'ok'
            ? 'Copied'
            : copied === 'failed'
              ? 'Copy failed'
              : 'Copy record'}
        </button>
      </div>
      <div className="mt-3">
        <HighlightedRecord step={step} />
      </div>
      {removed.length > 0 && (
        <p className="mt-2 text-xs text-gray-6">
          Removes: {removed.map((t) => `${t}=`).join(', ')}
        </p>
      )}
    </li>
  );
}

export function ChangePlanCard({ plan }: { plan: ChangePlan }) {
  return (
    <section className="rounded-xl border border-gray-3 bg-gray-2 p-5">
      <h2 className="text-base font-medium text-gray-10">
        Next change to publish
      </h2>
      <p className="text-sm text-gray-6">
        TXT record at <code className="text-gray-8">{plan.host}</code>
      </p>

      <div className="mt-4">
        <p className="text-xs text-gray-6">Current record</p>
        <code className="mt-1 block break-all rounded-lg bg-gray-1 px-3 py-2 text-xs text-gray-7">
          {plan.current ?? 'none published'}
        </code>
      </div>

      {plan.steps.length > 0 && (
        <ol className="mt-4 space-y-3">
          {plan.steps.map((s, i) => (
            <Step key={s.record} step={s} index={i} />
          ))}
        </ol>
      )}

      {plan.notes.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm text-gray-7">
          {plan.notes.map((n) => (
            <li key={n} className="flex items-start gap-2">
              <span
                className="mt-0.5 w-4 shrink-0 text-center text-gray-6"
                aria-hidden="true"
              >
                i
              </span>
              <span>{n}</span>
            </li>
          ))}
        </ul>
      )}

      {plan.steps.length > 0 && (
        <p className="mt-4 text-xs text-gray-6">
          After you publish it, press <strong>Check again</strong> in the DNS
          section: the change appears in the DNS history, and the next reports
          show its effect.
        </p>
      )}
    </section>
  );
}
