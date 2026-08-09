import { NextRequest, NextResponse } from 'next/server';
import { syncAll } from '@/lib/truelayer';

export const dynamic = 'force-dynamic';

function currentUserId(): string {
  return process.env.PETRICCO_USER_ID || 'default';
}

export async function POST(req: NextRequest) {
  try {
    const result = await syncAll(currentUserId());
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown_error';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  // Same shape as POST — useful for cron/webhook later.
  return POST(req);
}