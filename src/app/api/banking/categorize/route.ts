import { NextRequest, NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/api-auth';
import { listBankTransactions } from '@/lib/bank-store';
import { runCategorization } from '@/lib/categorize';
import { runAttribution } from '@/lib/attribution';
import { runAskReview } from '@/app/api/banking/review/ask/route';
import { ensureBankReady } from '../_ready';

// POST /api/banking/categorize — machine/cron endpoint (gated by the shared
// x-cron-secret, same guard as /api/banking/sync), also callable manually.
// Runs runCategorization for every month that currently has an
// uncategorized bank transaction (derived from the review queue itself, so
// this naturally shrinks as things get assigned/reviewed rather than
// re-scanning the full transaction history on every run). Intended to run
// daily alongside the sync cron. See
// docs/2026-08-15-agent-and-bank-automation-design.md (wave 2b).
export const dynamic = 'force-dynamic';

function distinctUncategorizedMonths(): Array<{ year: number; month: number }> {
  const rows = listBankTransactions({ status: 'uncategorized' });
  const seen = new Set<string>();
  const out: Array<{ year: number; month: number }> = [];
  for (const r of rows) {
    if (!r.booking_date) continue;
    const ym = r.booking_date.slice(0, 7); // 'YYYY-MM'
    if (seen.has(ym)) continue;
    seen.add(ym);
    out.push({ year: Number(ym.slice(0, 4)), month: Number(ym.slice(5, 7)) });
  }
  return out;
}

export async function POST(req: NextRequest) {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  // CSRF/consistency guard, same as the app's other mutating POST routes.
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ ok: false, error: 'content-type must be application/json' }, { status: 400 });
  }

  try {
    ensureBankReady();
    const months = distinctUncategorizedMonths();

    let assigned = 0;
    let needsReview = 0;
    for (const m of months) {
      const res = await runCategorization(m);
      assigned += res.assigned;
      needsReview += res.needsReview;
    }

    // Best-effort intelligence pass after (re)categorization: de-dup internal
    // transfers + plan-aware month attribution. Non-fatal — a failure here
    // never fails the categorize run.
    let attributedMoves = 0;
    try {
      attributedMoves = runAttribution().length;
    } catch (err) {
      console.error('[banking] post-categorize attribution failed', err instanceof Error ? err.message : err);
    }

    // Best-effort WhatsApp ask sweep after attribution has had a chance to
    // mark candidates unallocated. Non-fatal — a failure here never fails
    // the categorize run.
    try {
      await runAskReview();
    } catch (err) {
      console.error('[banking] post-categorize ask sweep failed', err instanceof Error ? err.message : err);
    }

    return NextResponse.json({ ok: true, months: months.length, assigned, needsReview, attributedMoves });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown_error';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// Categorization mutates stored bank data — require POST (with the cron
// secret) so this isn't a naked, CSRF-able GET (mirrors /api/banking/sync).
export async function GET(_req: NextRequest) {
  return NextResponse.json({ ok: false, error: 'method_not_allowed' }, { status: 405 });
}
