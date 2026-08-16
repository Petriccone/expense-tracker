import { NextRequest, NextResponse } from 'next/server';

// Ultra-cheap liveness probe — must NOT touch native modules so a
// better-sqlite3 load failure can't mask the underlying issue.
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  // Unauthenticated endpoint — don't return internal filesystem paths
  // (cwd, PETRICCO_DATA_DIR), only presence/config flags.
  return NextResponse.json({
    ok: true,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    env: {
      PETRICCO_DATA_DIR: process.env.PETRICCO_DATA_DIR ? 'set' : 'missing',
      GOCARDLESS_SECRET_ID: process.env.GOCARDLESS_SECRET_ID ? 'set' : 'missing',
      GOCARDLESS_SECRET_KEY: process.env.GOCARDLESS_SECRET_KEY ? 'set' : 'missing',
      TRUELAYER_TOKEN_ENC_KEY: process.env.TRUELAYER_TOKEN_ENC_KEY ? 'set' : 'missing',
    },
  });
}