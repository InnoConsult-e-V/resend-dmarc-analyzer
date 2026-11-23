import { NextResponse } from 'next/server';
import { updateState } from '@/lib/state/store';

export const dynamic = 'force-dynamic';

/** "Mark as reviewed": the baseline for "since your last review". */
export async function POST() {
  try {
    const state = await updateState({ reviewedAt: new Date().toISOString() });
    return NextResponse.json({ reviewedAt: state.reviewedAt });
  } catch {
    return NextResponse.json(
      { error: 'Could not save the review time' },
      { status: 500 },
    );
  }
}
