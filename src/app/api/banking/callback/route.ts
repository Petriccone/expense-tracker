import { NextRequest, NextResponse } from 'next/server';
import {
  createSession,
  getSession as getEbSession,
  getTransactions,
  mapTransactionBatch,
} from '@/lib/enablebanking';
import { getPendingState, clearPendingState, saveSession, upsertTransactions, setLastSyncAt } from '@/lib/bank-store';
import { ensureBankReady } from '../_ready';

// GET /api/banking/callback?code=...&state=...
// Enable Banking redirects the user here after they consent at their bank.
// Validates `state` against the one minted by /api/banking/connect (anti-CSRF
// on this OAuth-style redirect), creates the session, stores it + the linked
// account UIDs, then kicks off a best-effort deep backfill of transactions
// for every account (fire-and-forget — see runBackfill) while the session is
// fresh.
//
// There's no /banking page yet (wave 2b builds the UI), so this returns JSON
// instead of redirecting into the app.
export const dynamic = 'force-dynamic';

// Deep backfill window on first connect — wide enough to seed real history,
// still well inside any bank's transaction retention.
const BACKFILL_DAYS = 730;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Deep backfill for every linked account. Runs fire-and-forget from the GET
// handler (mirrors gocardless/callback's finalizeRequisition) so the
// bank-redirect round trip stays fast instead of blocking on ~730 days x N
// accounts of pagination. Non-fatal per account — a failure here doesn't
// undo the connection; /api/banking/sync catches up incrementally on the
// next scheduled run.
async function runBackfill(accountUids: string[]): Promise<void> {
  const dateTo = isoDate(new Date());
  const dateFrom = isoDate(new Date(Date.now() - BACKFILL_DAYS * 24 * 60 * 60 * 1000));
  let inserted = 0;
  let duplicates = 0;
  const failedAccounts: string[] = [];
  const truncatedAccounts: string[] = [];

  for (const accountUid of accountUids) {
    try {
      const { transactions, truncated } = await getTransactions(accountUid, { dateFrom, dateTo });
      if (truncated) truncatedAccounts.push(accountUid);
      const mapped = mapTransactionBatch(accountUid, transactions);
      const res = upsertTransactions(mapped);
      inserted += res.inserted;
      duplicates += res.duplicates;
    } catch (err) {
      failedAccounts.push(accountUid);
      console.error('[banking] backfill failed for an account', err instanceof Error ? err.message : err);
    }
  }
  setLastSyncAt(new Date().toISOString());
  if (failedAccounts.length > 0 || truncatedAccounts.length > 0) {
    console.warn('[banking] backfill finished with issues', {
      inserted,
      duplicates,
      failedAccounts: failedAccounts.length,
      truncatedAccounts: truncatedAccounts.length,
    });
  }
}

export async function GET(req: NextRequest) {
  try {
    ensureBankReady();

    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const bankError = url.searchParams.get('error');

    if (bankError) {
      return NextResponse.json({ ok: false, error: bankError }, { status: 400 });
    }
    if (!code || !state) {
      return NextResponse.json({ ok: false, error: 'missing code or state' }, { status: 400 });
    }

    const pending = getPendingState();
    if (!pending || pending !== state) {
      return NextResponse.json({ ok: false, error: 'state_mismatch' }, { status: 400 });
    }
    clearPendingState();

    const session = await createSession(code);

    // Best-effort — a failure to read back valid_until shouldn't abort a
    // connection that otherwise succeeded.
    const validUntil = await getEbSession(session.session_id)
      .then((s) => s.validUntil ?? null)
      .catch(() => null);

    saveSession({
      session_id: session.session_id,
      account_uids: session.accounts,
      valid_until: validUntil,
      aspsp: 'Revolut',
    });

    // Fire-and-forget: don't make the bank-redirect round trip wait on the
    // full backfill. Errors are logged; /api/banking/status reflects
    // progress once it lands.
    runBackfill(session.accounts).catch((err) => {
      console.error('[banking] backfill failed', err instanceof Error ? err.message : err);
    });

    return NextResponse.json({
      ok: true,
      sessionId: session.session_id,
      accounts: session.accounts.length,
      backfill: 'started',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown_error';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
