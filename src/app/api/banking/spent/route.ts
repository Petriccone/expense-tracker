import { NextRequest, NextResponse } from 'next/server';
import { initBankSchema, bankSpentByCategory } from '@/lib/bank-store';

// GET /api/banking/spent?year=YYYY&month=M — the bank-derived contribution to
// "gasto" per category for one month (SUM(abs(amount)) of booked,
// categorized bank_transactions). budget_categories.spent (the manual/
// WhatsApp-set portion) is untouched — the UI adds this on top:
// gasto = spent + bankSpent[categoryId]. See
// docs/2026-08-15-agent-and-bank-automation-design.md (wave 2b).
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    initBankSchema();
    const url = new URL(req.url);
    const yearParam = url.searchParams.get('year');
    const monthParam = url.searchParams.get('month');
    if (!yearParam || !monthParam) {
      return NextResponse.json({ error: 'year and month query params are required' }, { status: 400 });
    }
    const year = Number(yearParam);
    const month = Number(monthParam);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: 'year and month must be valid integers (month 1-12)' }, { status: 400 });
    }
    return NextResponse.json(bankSpentByCategory(year, month));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown_error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
