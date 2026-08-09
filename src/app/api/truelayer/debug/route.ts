import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

// Debug endpoint — reads connections without decrypting. Never returns tokens,
// just the row shape so we can see if anything was saved at all.
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  try {
    const db = getDb();
    const rows = db.prepare(
      'SELECT id, user_id, provider_id, expires_at, created_at FROM truelayer_connections'
    ).all();
    const accounts = db.prepare(
      'SELECT id, truelayer_id, display_name FROM truelayer_accounts'
    ).all();
    const transactions = db.prepare(
      'SELECT id, account_id, amount, currency, description, posted_at FROM truelayer_transactions ORDER BY posted_at DESC LIMIT 5'
    ).all();
    return NextResponse.json({
      connections: rows,
      accounts,
      transactions,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}