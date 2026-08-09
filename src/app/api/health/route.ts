import { NextRequest, NextResponse } from 'next/server';
import { dbInfo } from '@/lib/db';

// Quick health/diagnostic endpoint — confirms SQLite path + table presence.
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  try {
    const info = dbInfo();
    return NextResponse.json({ ok: true, ...info });
  } catch (err) {
    // Surface the error message AND a stack so we can see what's blowing up
    // in the deployed container.
    const message = err instanceof Error ? err.message : 'unknown';
    const stack = err instanceof Error ? err.stack : '';
    console.error('[health] failed:', err);
    return NextResponse.json(
      { ok: false, error: message, stack, cwd: process.cwd(), envDir: process.env.PETRICCO_DATA_DIR },
      { status: 500 },
    );
  }
}