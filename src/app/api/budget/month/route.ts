import { NextRequest, NextResponse } from 'next/server';
import { getMonthByYM } from '@/lib/budget-store';
import { ensureBudgetReady } from '../_ready';
import { budgetErrorResponse } from '../_errors';

// GET /api/budget/month?year=YYYY&month=M — a single month by (year, month),
// fully hydrated. Distinct from /api/budget/current (always the latest
// month): used by the /banco review queue (wave 2b) to fetch the budget
// categories for a bank transaction's own booking month, which may not be
// the currently-viewed month. 404 if that month doesn't exist yet — the UI
// uses that to prompt "crie o mês ... primeiro" instead of showing a
// dropdown. See docs/2026-08-15-agent-and-bank-automation-design.md.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    ensureBudgetReady();
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

    const found = getMonthByYM(year, month);
    if (!found) {
      return NextResponse.json(
        { error: `no budget month for ${year}-${String(month).padStart(2, '0')}` },
        { status: 404 },
      );
    }
    return NextResponse.json(found);
  } catch (err) {
    return budgetErrorResponse(err);
  }
}
