import { NextResponse } from 'next/server';
import { resetAccessToken } from '@/lib/graph/client';
import { clearAuth } from '@/lib/graph/token-store';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await clearAuth();
  } catch {
    // nothing to clear
  }
  resetAccessToken();
  return NextResponse.json({ signedIn: false });
}
