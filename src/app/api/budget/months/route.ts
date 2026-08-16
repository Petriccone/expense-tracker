import { NextRequest, NextResponse } from 'next/server';
import { listMonths, createNextMonth } from '@/lib/budget-store';
import { ensureBudgetReady } from '../_ready';
import { budgetErrorResponse } from '../_errors';

// GET  /api/budget/months — id/year/month summaries for the month switcher.
// POST /api/budget/months — carry-forward the latest month into the next one
//   (categories + incomes copied, planned/salary kept, spent reset to 0).
//   Store throws if the target month already exists (→ 409) or there's no
//   prior month to carry forward from (→ 400).
// See docs/2026-08-15-budget-model-redesign-design.md.

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  try {
    ensureBudgetReady();
    return NextResponse.json(listMonths());
  } catch (err) {
    return budgetErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    // CSRF guard: a cross-site form/simple-request can't set an arbitrary
    // Content-Type without triggering a preflight this app doesn't answer.
    // Requiring application/json blocks that vector even though this route
    // takes no body.
    if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      return NextResponse.json({ error: 'content-type must be application/json' }, { status: 400 });
    }

    ensureBudgetReady();
    const month = createNextMonth();
    return NextResponse.json(month);
  } catch (err) {
    return budgetErrorResponse(err);
  }
}
