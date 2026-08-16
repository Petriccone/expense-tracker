import { NextRequest, NextResponse } from 'next/server';
import { syncAll } from '@/lib/gocardless';

// POST /api/gocardless/manual-sync — browser counterpart to /sync (the
// cron-secret-gated machine endpoint). Triggered by the "Sync now" button on
// /connections. No x-cron-secret: it's protected by the app-wide Traefik
// basic-auth at deploy and only pulls data (non-destructive).
export const dynamic = 'force-dynamic';

function currentUserId(): string {
  return process.env.PETRICCO_USER_ID || 'default';
}

export async function POST(_req: NextRequest) {
  try {
    const result = await syncAll(currentUserId());
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown_error';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function GET(_req: NextRequest) {
  return NextResponse.json({ ok: false, error: 'method_not_allowed' }, { status: 405 });
}
