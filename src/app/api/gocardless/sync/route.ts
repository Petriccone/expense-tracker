import { NextRequest, NextResponse } from 'next/server';
import { syncAll } from '@/lib/gocardless';
import { requireCronSecret } from '@/lib/api-auth';

// POST /api/gocardless/sync — machine/cron endpoint. Gated by the shared
// x-cron-secret (INTERNAL_API_SECRET). Re-pulls transactions for every
// linked bank. On the GoCardless free tier the per-account transactions
// endpoint is rate-limited (as low as ~4 calls/account/day), so schedule
// this once or twice a day, NOT every few hours.
export const dynamic = 'force-dynamic';

function currentUserId(): string {
  return process.env.PETRICCO_USER_ID || 'default';
}

export async function POST(req: NextRequest) {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  try {
    const result = await syncAll(currentUserId());
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown_error';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// Sync mutates stored bank data — require POST (with the cron secret) so this
// isn't a naked, CSRF-able GET.
export async function GET(_req: NextRequest) {
  return NextResponse.json({ ok: false, error: 'method_not_allowed' }, { status: 405 });
}
