import { NextRequest, NextResponse } from 'next/server';
import { listBankTransactions } from '@/lib/bank-store';
import { toTransactionApiShape } from '../_shape';
import { ensureBankReady } from '../_ready';

// GET /api/banking/transactions?month=YYYY-MM&status=uncategorized|all — the
// review queue (status=uncategorized, the default UI view) and the full list
// (status=all). `month` is optional (omit for all months). See
// docs/2026-08-15-agent-and-bank-automation-design.md (wave 2b).
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    ensureBankReady();
    const url = new URL(req.url);
    const month = url.searchParams.get('month') ?? undefined;
    if (month !== undefined && !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 });
    }
    const status = url.searchParams.get('status') === 'uncategorized' ? 'uncategorized' : 'all';

    const rows = listBankTransactions({ monthYear: month, status });
    return NextResponse.json(rows.map(toTransactionApiShape));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown_error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
