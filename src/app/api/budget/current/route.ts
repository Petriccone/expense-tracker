import { NextRequest, NextResponse } from 'next/server';
import { getCurrentMonth } from '@/lib/budget-store';
import { ensureBudgetReady } from '../_ready';
import { budgetErrorResponse } from '../_errors';

// GET /api/budget/current — the latest budget month (by year, month), fully
// hydrated with categories, incomes and computed rollups. See
// docs/2026-08-15-budget-model-redesign-design.md.

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  try {
    ensureBudgetReady();
    const month = getCurrentMonth();
    if (!month) {
      return NextResponse.json({ error: 'no current month' }, { status: 404 });
    }
    return NextResponse.json(month);
  } catch (err) {
    return budgetErrorResponse(err);
  }
}
