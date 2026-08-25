import { NextRequest, NextResponse } from 'next/server';
import { updateCategory, deleteCategory } from '@/lib/budget-store';
import type { BudgetGroup } from '@/types/budget';
import { ensureBudgetReady } from '../../_ready';
import { budgetErrorResponse } from '../../_errors';

// PATCH  /api/budget/categories/[id] — edit name/group/planned/spent.
// DELETE /api/budget/categories/[id] — remove the row (idempotent → 204).
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
    const { name, group, planned, spent, spentAdjustment } = body as Record<string, unknown>;

    const patch = {
      name: name as string | undefined,
      group: group as BudgetGroup | undefined,
      planned: planned as number | undefined,
      spent: spent as number | undefined,
      spentAdjustment: spentAdjustment as number | undefined,
    } satisfies Parameters<typeof updateCategory>[1];
    const category = updateCategory(id, patch);
    return NextResponse.json(category);
  } catch (err) {
    return budgetErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    ensureBudgetReady();
    const { id } = await params;
    deleteCategory(id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return budgetErrorResponse(err);
  }
}
