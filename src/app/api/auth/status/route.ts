import { NextResponse } from 'next/server';
import { readAuth } from '@/lib/graph/token-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const auth = await readAuth();
    return NextResponse.json({
      signedIn: !!auth,
      account: auth?.account ?? null,
    });
  } catch {
    // e.g. missing configuration: treat as signed out
    return NextResponse.json({ signedIn: false, account: null });
  }
}
