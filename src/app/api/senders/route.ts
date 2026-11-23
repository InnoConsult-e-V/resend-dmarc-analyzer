import { NextResponse } from 'next/server';
import { applyDecision, readDecisions } from '@/lib/senders/decisions';
import { validateDecisionInput } from '@/lib/senders/keys';

export const dynamic = 'force-dynamic';

const MAX_BODY_CHARS = 20_000;

/** The admin's decisions about sending sources (approved / not mine). */
export async function GET() {
  return NextResponse.json({ decisions: await readDecisions() });
}

/**
 * Approve, mark as "not mine", or clear one source or a list of sources.
 * Strictly validated; same-origin only (enforced by the proxy).
 */
export async function POST(request: Request) {
  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) {
    return NextResponse.json({ error: 'Request too large' }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const input = validateDecisionInput(body);
  if (!input.ok) {
    return NextResponse.json({ error: input.error }, { status: 400 });
  }
  try {
    const decisions = await applyDecision(input.keys, input.decision, {
      label: input.label,
      note: input.note,
    });
    return NextResponse.json({ decisions });
  } catch {
    return NextResponse.json(
      { error: 'Could not save the decision' },
      { status: 500 },
    );
  }
}
