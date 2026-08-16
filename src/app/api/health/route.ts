import { NextRequest, NextResponse } from 'next/server';
import { dbInfo } from '@/lib/db';

// Quick health/diagnostic endpoint — confirms SQLite path + table presence.
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  try {
    const info = dbInfo();
    // Don't disclose the absolute file path or table list to callers —
    // this endpoint is unauthenticated.
    return NextResponse.json({ ok: true, size: info.size });
  } catch (err) {
    // Log the full detail (stack, cwd, env dir) server-side only — do not
    // return it to the caller, this endpoint is unauthenticated.
    const message = err instanceof Error ? err.message : 'unknown';
    console.error('[health] failed:', err, { cwd: process.cwd(), envDir: process.env.PETRICCO_DATA_DIR });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}