import { NextRequest, NextResponse } from 'next/server';

// Ultra-cheap liveness probe — must NOT touch native modules so a
// better-sqlite3 load failure can't mask the underlying issue.
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  return NextResponse.json({
    ok: true,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cwd: process.cwd(),
    env: {
      PETRICCO_DATA_DIR: process.env.PETRICCO_DATA_DIR || null,
      TRUELAYER_ENV: process.env.TRUELAYER_ENV || null,
      TRUELAYER_CLIENT_ID: process.env.TRUELAYER_CLIENT_ID ? 'set' : 'missing',
      TRUELAYER_CLIENT_SECRET: process.env.TRUELAYER_CLIENT_SECRET ? 'set' : 'missing',
    },
  });
}