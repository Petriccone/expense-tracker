import { NextRequest, NextResponse } from 'next/server';
import { getTransactionById, setTransactionCategory, setTransactionIgnored } from '@/lib/bank-store';
import { getMonthByYM } from '@/lib/budget-store';
import { toTransactionApiShape } from '../../_shape';
import { ensureBankReady } from '../../_ready';

// PATCH /api/banking/transactions/[id] — manual review actions. body is
// EITHER {categoryId} (assign) OR {ignored: true|false} (the "não-é-gasto"
// dismiss/undismiss action).
//
// categoryId is validated against THIS transaction's OWN booking month's
// budget categories — never any other month. Category ids are per-month
// UUIDs, so a transaction from month X assigned a month-Y category id would
// get bucketed by bankSpentByCategory(X) under an id that doesn't exist in
// X's category list and silently vanish from the display. Rejects 400 if
// the transaction's own month has no budget month yet, or if categoryId
// isn't one of that month's categories. See
// docs/2026-08-15-agent-and-bank-automation-design.md (wave 2b fix).
//
// No content-type/CSRF guard needed: PATCH is never a CORS-simple request,
// so a cross-site page can't trigger it without a preflight this app
// doesn't answer (same reasoning as the budget PATCH routes).
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    ensureBankReady();
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
    const { categoryId, ignored } = body as Record<string, unknown>;

    const tx = getTransactionById(id);
    if (!tx) {
      return NextResponse.json({ error: `transaction ${id} not found` }, { status: 404 });
    }

    if (ignored !== undefined) {
      if (typeof ignored !== 'boolean') {
        return NextResponse.json({ error: 'ignored must be a boolean' }, { status: 400 });
      }
      const updated = setTransactionIgnored(id, ignored);
      return NextResponse.json(toTransactionApiShape(updated));
    }

    if (typeof categoryId !== 'string' || !categoryId) {
      return NextResponse.json({ error: 'categoryId is required' }, { status: 400 });
    }

    const ym = tx.booking_date?.match(/^(\d{4})-(\d{2})/);
    if (!ym) {
      return NextResponse.json(
        { error: 'transaction has no booking date to resolve a budget month' },
        { status: 400 },
      );
    }
    const monthYear = `${ym[1]}-${ym[2]}`;
    const budgetMonth = getMonthByYM(Number(ym[1]), Number(ym[2]));
    if (!budgetMonth) {
      return NextResponse.json({ error: `no budget month for ${monthYear} yet` }, { status: 400 });
    }
    if (!budgetMonth.categories.some((c) => c.id === categoryId)) {
      return NextResponse.json(
        { error: `categoryId does not belong to this transaction's budget month (${monthYear})` },
        { status: 400 },
      );
    }

    const updated = setTransactionCategory(id, categoryId);
    return NextResponse.json(toTransactionApiShape(updated));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown_error';
    const status = /not found/i.test(msg) ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
