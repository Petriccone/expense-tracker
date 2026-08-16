import { NextRequest, NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/api-auth';
import { getTransactions, mapTransactionBatch, EnableBankingError } from '@/lib/enablebanking';
import {
  initBankSchema,
  getLatestSession,
  upsertTransactions,
  getLastSyncAt,
  setLastSyncAt,
  getRateLimitedUntil,
  setRateLimitedUntil,
} from '@/lib/bank-store';
import { runCategorization } from '@/lib/categorize';

// POST /api/banking/sync — machine/cron endpoint, gated by the shared
// x-cron-secret (INTERNAL_API_SECRET, same guard as /api/gocardless/sync).
// Incremental: pulls each linked account from (last sync - 1 day) to today,
// upserts (dedup on id), and bumps last-sync on success.
//
// On ASPSP_RATE_LIMIT_EXCEEDED this stops immediately (does not try the
// remaining accounts), persists a backoff window, and returns 429 — the next
// scheduled run picks up where this one left off via last-sync, and
// short-circuits (no fetch) while still inside the backoff window.
export const dynamic = 'force-dynamic';

// 1-day overlap on the incremental window so a transaction posted right at
// the last-sync boundary is never missed; upsert's dedup makes the overlap
// free.
const LOOKBACK_MS = 24 * 60 * 60 * 1000;

// How long to back off after an ASPSP_RATE_LIMIT_EXCEEDED before trying
// again. Persisted (not just in-memory) so a redeploy/restart between cron
// runs doesn't forget the backoff and immediately re-trigger the same limit.
const RATE_LIMIT_BACKOFF_MS = 6 * 60 * 60 * 1000;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  try {
    initBankSchema();

    const rateLimitedUntil = getRateLimitedUntil();
    if (rateLimitedUntil && Date.now() < Date.parse(rateLimitedUntil)) {
      return NextResponse.json(
        { ok: false, error: 'rate_limited', rateLimitedUntil },
        { status: 429 },
      );
    }

    const session = getLatestSession();
    if (!session || session.account_uids.length === 0) {
      return NextResponse.json({ ok: false, error: 'no linked bank connection' }, { status: 400 });
    }

    const lastSync = getLastSyncAt();
    const from = lastSync ? Date.parse(lastSync) : Date.now();
    const dateFrom = isoDate(new Date(from - LOOKBACK_MS));
    const dateTo = isoDate(new Date());

    let inserted = 0;
    let duplicates = 0;
    const truncatedAccounts: string[] = [];
    const touchedMonths = new Set<string>(); // 'YYYY-MM', for the post-sync categorization pass
    for (const accountUid of session.account_uids) {
      try {
        const { transactions, truncated } = await getTransactions(accountUid, { dateFrom, dateTo });
        if (truncated) truncatedAccounts.push(accountUid);
        const mapped = mapTransactionBatch(accountUid, transactions);
        for (const t of mapped) {
          if (t.booking_date) touchedMonths.add(t.booking_date.slice(0, 7));
        }
        const res = upsertTransactions(mapped);
        inserted += res.inserted;
        duplicates += res.duplicates;
      } catch (err) {
        if (err instanceof EnableBankingError && err.code === 'ASPSP_RATE_LIMIT_EXCEEDED') {
          setRateLimitedUntil(new Date(Date.now() + RATE_LIMIT_BACKOFF_MS).toISOString());
          return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 });
        }
        throw err;
      }
    }

    setLastSyncAt(new Date().toISOString());
    if (truncatedAccounts.length > 0) {
      console.warn('[banking] sync finished with truncated accounts (page cap hit)', {
        truncatedAccounts: truncatedAccounts.length,
      });
    }

    // Best-effort: categorize the months touched by this sync. Wrapped so a
    // categorization failure (e.g. the LLM provider erroring) never fails an
    // otherwise-successful sync — the review queue / next cron run catches up.
    let categorized: { assigned: number; needsReview: number } | null = null;
    try {
      let assigned = 0;
      let needsReview = 0;
      for (const ym of touchedMonths) {
        const res = await runCategorization({ year: Number(ym.slice(0, 4)), month: Number(ym.slice(5, 7)) });
        assigned += res.assigned;
        needsReview += res.needsReview;
      }
      categorized = { assigned, needsReview };
    } catch (err) {
      console.error('[banking] post-sync categorization failed', err instanceof Error ? err.message : err);
    }

    return NextResponse.json({
      ok: true,
      accounts: session.account_uids.length,
      inserted,
      duplicates,
      categorized,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown_error';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// Sync mutates stored bank data — require POST (with the cron secret) so
// this isn't a naked, CSRF-able GET.
export async function GET(_req: NextRequest) {
  return NextResponse.json({ ok: false, error: 'method_not_allowed' }, { status: 405 });
}
