import { NextRequest, NextResponse } from 'next/server';
import { getMonth, updateMonth } from '@/lib/budget-store';
import { withAccountBalance } from '@/lib/account-balance';
import { ensureBudgetReady } from '../../_ready';
import { budgetErrorResponse } from '../../_errors';

// GET   /api/budget/months/[id] — a single month, fully hydrated.
// PATCH /api/budget/months/[id] — edit `save` and/or `note`.
// See docs/2026-08-15-budget-model-redesign-design.md.

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    ensureBudgetReady();
    const { id } = await params;
    const month = getMonth(id);
    if (!month) {
      return NextResponse.json({ error: `month ${id} not found` }, { status: 404 });
    }
    return NextResponse.json(withAccountBalance(month));
  } catch (err) {
    return budgetErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    ensureBudgetReady();
    const { id } = await params;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
    }
    if (typeof body !== 'object' || body === null) {
      return NextResponse.json({ error: 'invalid request body' }, { status: 400 });
    }
    const { save, note } = body as Record<string, unknown>;
    // `note` accepts string or null (null clears it) — guard the type here
    // so a wrong-typed value can't corrupt the TEXT column.
    if (note !== undefined && note !== null && typeof note !== 'string') {
      return NextResponse.json({ error: 'note must be a string or null' }, { status: 400 });
    }

    const month = updateMonth(id, {
      save: save as number | undefined,
      note: note as string | null | undefined,
    });
    return NextResponse.json(withAccountBalance(month));
  } catch (err) {
    return budgetErrorResponse(err);
  }
}
