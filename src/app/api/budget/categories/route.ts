import { NextRequest, NextResponse } from 'next/server';
import { addCategory } from '@/lib/budget-store';
import type { BudgetGroup } from '@/types/budget';
import { ensureBudgetReady } from '../_ready';
import { budgetErrorResponse } from '../_errors';

// POST /api/budget/categories — add a category (Fixos/Variáveis/Extras row)
// to a month. See docs/2026-08-15-budget-model-redesign-design.md.

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
    const { monthId, group, name, planned, spent } = body as Record<string, unknown>;
    // monthId is a positional store arg, not part of the validated input
    // object below — check it here, everything else is validated by the
    // store's assert* helpers (they throw a message-rich Error → 400).
    if (typeof monthId !== 'string' || !monthId) {
      return NextResponse.json({ error: 'monthId is required' }, { status: 400 });
    }

    const category = addCategory(monthId, {
      group: group as BudgetGroup,
      name: name as string,
      planned: planned as number,
      spent: spent as number | undefined,
    });
    return NextResponse.json(category);
  } catch (err) {
    return budgetErrorResponse(err);
  }
}
