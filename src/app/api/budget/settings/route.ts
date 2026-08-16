import { NextRequest, NextResponse } from 'next/server';
import { getSettings, updateSettings } from '@/lib/budget-store';
import type { BudgetSettings } from '@/types/budget';
import { ensureBudgetReady } from '../_ready';
import { budgetErrorResponse } from '../_errors';

// GET   /api/budget/settings — savings opening balance, person labels, currency.
// PATCH /api/budget/settings — edit any subset of the above.
// See docs/2026-08-15-budget-model-redesign-design.md.

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  try {
    ensureBudgetReady();
    return NextResponse.json(getSettings());
  } catch (err) {
    return budgetErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    ensureBudgetReady();

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
    }
    if (typeof body !== 'object' || body === null) {
      return NextResponse.json({ error: 'invalid request body' }, { status: 400 });
    }

    const settings = updateSettings(body as Partial<BudgetSettings>);
    return NextResponse.json(settings);
  } catch (err) {
    return budgetErrorResponse(err);
  }
}
