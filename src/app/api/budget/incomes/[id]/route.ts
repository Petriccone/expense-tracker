import { NextRequest, NextResponse } from 'next/server';
import { updateIncome, deleteIncome } from '@/lib/budget-store';
import type { IncomeKind } from '@/types/budget';
import { ensureBudgetReady } from '../../_ready';
import { budgetErrorResponse } from '../../_errors';

// PATCH  /api/budget/incomes/[id] — edit label/amount/kind.
// DELETE /api/budget/incomes/[id] — remove the row (idempotent → 204).
// See docs/2026-08-15-budget-model-redesign-design.md.

export const dynamic = 'force-dynamic';

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
    const { label, amount, kind } = body as Record<string, unknown>;

    const income = updateIncome(id, {
      label: label as string | undefined,
      amount: amount as number | undefined,
      kind: kind as IncomeKind | undefined,
    });
    return NextResponse.json(income);
  } catch (err) {
    return budgetErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    ensureBudgetReady();
    const { id } = await params;
    deleteIncome(id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return budgetErrorResponse(err);
  }
}
