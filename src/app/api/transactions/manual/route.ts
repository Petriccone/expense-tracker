import { NextRequest, NextResponse } from 'next/server';
import { insertManualTransaction } from '@/lib/read-store';

// Write path for manually-added transactions (Add Transaction form, CSV
// import) — see docs/2026-08-14-m1-real-bank-autosync-design.md. Persists to
// the manual_transactions SQLite table so entries survive reload; the read
// API (GET /api/transactions) merges these with bank rows.

export const dynamic = 'force-dynamic';

function randomId(): string {
  return `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (
      !body ||
      typeof body.description !== 'string' || !body.description ||
      typeof body.amount !== 'number' || !Number.isFinite(body.amount) ||
      typeof body.category !== 'string' || !body.category ||
      typeof body.date !== 'string' || !body.date ||
      (body.type !== 'income' && body.type !== 'expense')
    ) {
      return NextResponse.json({ ok: false, error: 'invalid_transaction' }, { status: 400 });
    }

    const id = typeof body.id === 'string' && body.id ? body.id : randomId();
    const created_at = typeof body.createdAt === 'string' && body.createdAt
      ? body.createdAt
      : new Date().toISOString();

    const row = insertManualTransaction({
      id,
      type: body.type,
      amount: body.amount,
      description: body.description,
      category: body.category,
      date: body.date,
      notes: typeof body.notes === 'string' ? body.notes : null,
      created_at,
    });

    return NextResponse.json({ ok: true, transaction: row });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown_error';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
