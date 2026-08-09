import { NextRequest, NextResponse } from 'next/server';
import { dbInfo } from '@/lib/db';

// Quick health/diagnostic endpoint — confirms SQLite path + table presence.
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  try {
    return NextResponse.json({ ok: true, ...dbInfo() });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}