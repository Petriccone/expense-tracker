import { NextRequest, NextResponse } from 'next/server';
import { updateManualTransaction, deleteManualTransaction } from '@/lib/read-store';

// Edit/delete for a single manual transaction (id from manual_transactions).
// A bank-sourced id won't exist in this table — the update/delete is then a
// no-op (ok:true, transaction:null / deleted:false) rather than an error,
// since the UI doesn't distinguish bank vs. manual rows when acting on them.

export const dynamic = 'force-dynamic';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();

    // Partial update, but any field that IS present must pass the same
    // strict validation the create route (manual/route.ts POST) applies —
    // an unchecked type/description/category/date would silently corrupt
    // the row (e.g. type flips income/expense reporting everywhere).
    if (
      (body.type !== undefined && body.type !== 'income' && body.type !== 'expense') ||
      (body.amount !== undefined && (typeof body.amount !== 'number' || !Number.isFinite(body.amount))) ||
      (body.description !== undefined && (typeof body.description !== 'string' || !body.description)) ||
      (body.category !== undefined && (typeof body.category !== 'string' || !body.category)) ||
      (body.date !== undefined && (typeof body.date !== 'string' || !body.date))
    ) {
      return NextResponse.json({ ok: false, error: 'invalid_transaction' }, { status: 400 });
    }

    const row = updateManualTransaction(id, {
      type: body.type,
      amount: typeof body.amount === 'number' ? body.amount : undefined,
      description: body.description,
      category: body.category,
      date: body.date,
      notes: body.notes !== undefined ? (typeof body.notes === 'string' ? body.notes : null) : undefined,
    });
    return NextResponse.json({ ok: true, transaction: row });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown_error';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const deleted = deleteManualTransaction(id);
    return NextResponse.json({ ok: true, deleted });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown_error';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
