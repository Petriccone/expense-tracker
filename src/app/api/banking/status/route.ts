import { NextRequest, NextResponse } from 'next/server';
import { initBankSchema, getLatestSession, getLastSyncAt, countTransactions } from '@/lib/bank-store';

// GET /api/banking/status — connection summary for a future "Banco" page
// (wave 2b) and for manual checks in the meantime.
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  try {
    initBankSchema();
    const session = getLatestSession();
    return NextResponse.json({
      ok: true,
      connected: session !== null,
      validUntil: session?.valid_until ?? null,
      lastSync: getLastSyncAt(),
      accountCount: session?.account_uids.length ?? 0,
      txCount: countTransactions(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown_error';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
