import { NextRequest, NextResponse } from 'next/server';
import { addIncome } from '@/lib/budget-store';
import type { IncomeKind } from '@/types/budget';
import { ensureBudgetReady } from '../_ready';
import { budgetErrorResponse } from '../_errors';

// POST /api/budget/incomes — add an income row (salary or extra) to a
// month. See docs/2026-08-15-budget-model-redesign-design.md.

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    // CSRF guard: a cross-site form/simple-request can't set an arbitrary
    // Content-Type without triggering a preflight this app doesn't answer.
    if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      return NextResponse.json({ error: 'content-type must be application/json' }, { status: 400 });
    }

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
    const { monthId, label, amount, kind } = body as Record<string, unknown>;
    // monthId is a positional store arg, not part of the validated input
    // object below — check it here, everything else is validated by the
    // store's assert* helpers (they throw a message-rich Error → 400).
    if (typeof monthId !== 'string' || !monthId) {
      return NextResponse.json({ error: 'monthId is required' }, { status: 400 });
    }

    const income = addIncome(monthId, {
      label: label as string,
      amount: amount as number,
      kind: kind as IncomeKind,
    });
    return NextResponse.json(income);
  } catch (err) {
    return budgetErrorResponse(err);
  }
}
