import { NextRequest, NextResponse } from 'next/server';
import { listAllAccounts } from '@/lib/read-store';

// Read API for connected bank accounts (M1 — see
// docs/2026-08-14-m1-real-bank-autosync-design.md).

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  try {
    const accounts = listAllAccounts();
    return NextResponse.json(accounts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown_error';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
