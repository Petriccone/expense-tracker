// Shared guard for internal/cron-triggered API routes (TrueLayer sync/reset
// today; any future internal-only route can reuse this). Keeps routes that
// mutate real bank data from being naked, unauthenticated GET/POST targets.
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';

const HEADER = 'x-cron-secret';

/**
 * Call first in any internal-only route handler:
 *
 *   const denied = requireCronSecret(req);
 *   if (denied) return denied;
 *
 * Behaviour:
 * - `INTERNAL_API_SECRET` set: request must send header `x-cron-secret`
 *   matching it exactly, else 401.
 * - `INTERNAL_API_SECRET` unset:
 *   - non-production (`NODE_ENV !== 'production'`): allowed — dev
 *     convenience so local/sandbox testing doesn't need the env set.
 *   - production: fail closed — 500, refuses to run unauthenticated.
 */
export function requireCronSecret(req: Request): Response | null {
  const secret = process.env.INTERNAL_API_SECRET;
  const isProd = process.env.NODE_ENV === 'production';

  if (!secret) {
    if (isProd) {
      return NextResponse.json(
        { ok: false, error: 'INTERNAL_API_SECRET is not set — refusing to run unauthenticated in production.' },
        { status: 500 },
      );
    }
    return null;
  }

  const provided = req.headers.get(HEADER) || '';
  const expected = Buffer.from(secret);
  const given = Buffer.from(provided);
  const match = expected.length === given.length && crypto.timingSafeEqual(expected, given);
  if (!match) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  return null;
}
