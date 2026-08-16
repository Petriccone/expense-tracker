// Unit tests for bank-store.ts — real SQLite in a temp dir (same pattern as
// budget-store.test.ts's DB-backed suite). Covers session round-trip,
// upsert dedup, and the settings helpers used by the connect/callback CSRF
// check and the sync cron's last-sync bookkeeping.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  initBankSchema,
  saveSession,
  getSession,
  getLatestSession,
  upsertTransactions,
  listTransactions,
  countTransactions,
  getPendingState,
  setPendingState,
  clearPendingState,
  getLastSyncAt,
  setLastSyncAt,
  getRateLimitedUntil,
  setRateLimitedUntil,
  listBankTransactions,
  setTransactionCategory,
  setTransactionIgnored,
  bankSpentByCategory,
  type BankTransactionInput,
} from './bank-store';

// getDb() (src/lib/db.ts) memoizes its connection at module scope on first
// use, so point PETRICCO_DATA_DIR at an isolated temp dir before the first
// DB touch in this process.
describe('bank-store (DB-backed, real SQLite)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bank-store-test-'));

  beforeAll(() => {
    process.env.PETRICCO_DATA_DIR = tmpDir;
    initBankSchema();
  });

  afterAll(() => {
    delete process.env.PETRICCO_DATA_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('saves and reads back a session, including account_uids as an array', () => {
    const saved = saveSession({
      session_id: 'sess-1',
      account_uids: ['acc-a', 'acc-b'],
      valid_until: '2027-01-01T00:00:00Z',
      aspsp: 'Revolut',
    });
    expect(saved.session_id).toBe('sess-1');
    expect(saved.account_uids).toEqual(['acc-a', 'acc-b']);

    const fetched = getSession('sess-1');
    expect(fetched).not.toBeNull();
    expect(fetched!.account_uids).toEqual(['acc-a', 'acc-b']);
    expect(fetched!.valid_until).toBe('2027-01-01T00:00:00Z');
    expect(fetched!.aspsp).toBe('Revolut');
  });

  it('getLatestSession returns the most recently created session', () => {
    saveSession({ session_id: 'sess-2', account_uids: ['acc-c'], valid_until: null, aspsp: 'Revolut' });
    const latest = getLatestSession();
    expect(latest).not.toBeNull();
    expect(latest!.session_id).toBe('sess-2');
  });

  it('getSession returns null for an unknown id', () => {
    expect(getSession('does-not-exist')).toBeNull();
  });

  it('upsertTransactions dedups on id — inserting the same id twice yields one row', () => {
    const row: BankTransactionInput = {
      id: 'tx-dedup-1',
      account_uid: 'acc-a',
      amount: -12.5,
      currency: 'EUR',
      credit_debit: 'DBIT',
      booking_date: '2026-08-01',
      value_date: '2026-08-01',
      description: 'Coffee',
      counterparty: 'Some Cafe',
      status: 'BOOK',
    };

    const first = upsertTransactions([row]);
    expect(first.inserted).toBe(1);
    expect(first.duplicates).toBe(0);

    const second = upsertTransactions([row]);
    expect(second.inserted).toBe(0);
    expect(second.duplicates).toBe(1);

    const rows = listTransactions().filter((r) => r.id === 'tx-dedup-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBeCloseTo(-12.5, 2);
    expect(rows[0].category_id).toBeNull();
    expect(rows[0].confidence).toBeNull();
  });

  it('upsertTransactions handles an empty array without touching the DB', () => {
    expect(upsertTransactions([])).toEqual({ inserted: 0, duplicates: 0 });
  });

  it('a window-slide never deletes a previously stored row — no reconciliation, plain insert-dedup', () => {
    // Regression test for the fixed data-loss bug: upsertTransactions used to
    // delete every non-BOOK row for an account on each call, assuming (like
    // gocardless.ts's safe pattern) that the batch passed in was the
    // complete current set. Enable Banking's getTransactions is
    // date-windowed, so that assumption was false — a row from an earlier
    // window would get deleted and never reinserted once the sync window
    // slid past it. Booked-only removes the delete entirely; assert a row
    // from an earlier call survives a later call for the same account whose
    // batch doesn't include it.
    const account = 'acc-window-slide';
    const earlier: BankTransactionInput = {
      id: 'tx-earlier-window',
      account_uid: account,
      amount: -9.5,
      currency: 'EUR',
      credit_debit: 'DBIT',
      booking_date: '2026-01-01',
      value_date: '2026-01-01',
      description: 'Old purchase',
      counterparty: 'Shop',
      status: 'BOOK',
    };
    upsertTransactions([earlier]);
    expect(listTransactions().some((r) => r.id === 'tx-earlier-window')).toBe(true);

    // A later incremental sync for the same account whose narrow window no
    // longer includes `earlier` — must not delete it.
    const later: BankTransactionInput = {
      id: 'tx-later-window',
      account_uid: account,
      amount: -3,
      currency: 'EUR',
      credit_debit: 'DBIT',
      booking_date: '2026-08-10',
      value_date: '2026-08-10',
      description: 'New purchase',
      counterparty: 'Shop',
      status: 'BOOK',
    };
    upsertTransactions([later]);

    const rows = listTransactions().filter((r) => r.account_uid === account);
    expect(rows.map((r) => r.id).sort()).toEqual(['tx-earlier-window', 'tx-later-window']);
  });

  it('a booked row re-fetched in a later (overlapping) window upserts idempotently — dedup on transaction_id, no dup', () => {
    const account = 'acc-idempotent-refetch';
    const row: BankTransactionInput = {
      id: 'tx-refetched',
      account_uid: account,
      amount: -9.5,
      currency: 'EUR',
      credit_debit: 'DBIT',
      booking_date: '2026-08-10',
      value_date: '2026-08-10',
      description: 'Card payment',
      counterparty: 'Shop',
      status: 'BOOK',
    };
    const first = upsertTransactions([row]);
    expect(first.inserted).toBe(1);
    // Same row, same id, re-fetched by the next sync's overlapping window.
    const second = upsertTransactions([row]);
    expect(second.inserted).toBe(0);
    expect(second.duplicates).toBe(1);

    expect(listTransactions().filter((r) => r.account_uid === account)).toHaveLength(1);
  });

  it('does not disturb rows on another account when a different account is upserted', () => {
    const untouched: BankTransactionInput = {
      id: 'tx-untouched',
      account_uid: 'acc-untouched',
      amount: -1,
      currency: 'EUR',
      credit_debit: 'DBIT',
      booking_date: '2026-08-10',
      value_date: '2026-08-10',
      description: 'Unrelated',
      counterparty: null,
      status: 'BOOK',
    };
    upsertTransactions([untouched]);
    upsertTransactions([
      {
        id: 'tx-other-account',
        account_uid: 'acc-other',
        amount: -1,
        currency: 'EUR',
        credit_debit: 'DBIT',
        booking_date: '2026-08-10',
        value_date: '2026-08-10',
        description: 'Other account',
        counterparty: null,
        status: 'BOOK',
      },
    ]);
    expect(listTransactions().some((r) => r.id === 'tx-untouched')).toBe(true);
  });

  it('listTransactions filters by since (booking_date) and counts total rows', () => {
    upsertTransactions([
      {
        id: 'tx-old',
        account_uid: 'acc-a',
        amount: -5,
        currency: 'EUR',
        credit_debit: 'DBIT',
        booking_date: '2020-01-01',
        value_date: '2020-01-01',
        description: 'Old',
        counterparty: null,
        status: 'BOOK',
      },
      {
        id: 'tx-new',
        account_uid: 'acc-a',
        amount: -7,
        currency: 'EUR',
        credit_debit: 'DBIT',
        booking_date: '2026-08-10',
        value_date: '2026-08-10',
        description: 'New',
        counterparty: null,
        status: 'BOOK',
      },
    ]);

    const recent = listTransactions({ since: '2026-01-01' });
    expect(recent.some((r) => r.id === 'tx-new')).toBe(true);
    expect(recent.some((r) => r.id === 'tx-old')).toBe(false);

    expect(countTransactions()).toBeGreaterThanOrEqual(3); // tx-dedup-1, tx-old, tx-new
  });

  it('pending-state round-trips and clears', () => {
    expect(getPendingState()).toBeNull();
    setPendingState('state-abc');
    expect(getPendingState()).toBe('state-abc');
    clearPendingState();
    expect(getPendingState()).toBeNull();
  });

  it('pending-state expires after its TTL — a stale value is treated as unset', () => {
    vi.useFakeTimers();
    try {
      setPendingState('state-ttl');
      expect(getPendingState()).toBe('state-ttl');
      vi.advanceTimersByTime(16 * 60 * 1000); // > 15 min TTL
      expect(getPendingState()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('last-sync round-trips', () => {
    expect(getLastSyncAt()).toBeNull();
    setLastSyncAt('2026-08-15T00:00:00.000Z');
    expect(getLastSyncAt()).toBe('2026-08-15T00:00:00.000Z');
  });

  it('rate-limited-until round-trips', () => {
    expect(getRateLimitedUntil()).toBeNull();
    setRateLimitedUntil('2026-08-15T06:00:00.000Z');
    expect(getRateLimitedUntil()).toBe('2026-08-15T06:00:00.000Z');
  });

  // ----- wave 2b: categorization + review queue -----

  it('setTransactionCategory round-trips category_id and confidence', () => {
    upsertTransactions([
      {
        id: 'tx-cat-1',
        account_uid: 'acc-a',
        amount: -20,
        currency: 'EUR',
        credit_debit: 'DBIT',
        booking_date: '2026-08-05',
        value_date: '2026-08-05',
        description: 'Tesco Superstore',
        counterparty: 'Tesco',
        status: 'BOOK',
      },
    ]);

    const updated = setTransactionCategory('tx-cat-1', 'cat-shop-id', 0.9);
    expect(updated.category_id).toBe('cat-shop-id');
    expect(updated.confidence).toBeCloseTo(0.9, 5);

    const fetched = listTransactions().find((r) => r.id === 'tx-cat-1');
    expect(fetched?.category_id).toBe('cat-shop-id');
    expect(fetched?.confidence).toBeCloseTo(0.9, 5);
  });

  it('setTransactionCategory throws for an unknown transaction id', () => {
    expect(() => setTransactionCategory('does-not-exist', 'some-cat')).toThrow(/not found/i);
  });

  it('listBankTransactions filters by monthYear and status=uncategorized', () => {
    upsertTransactions([
      {
        id: 'tx-review-uncategorized',
        account_uid: 'acc-review',
        amount: -5,
        currency: 'EUR',
        credit_debit: 'DBIT',
        booking_date: '2026-09-01',
        value_date: '2026-09-01',
        description: 'Some Shop',
        counterparty: null,
        status: 'BOOK',
      },
      {
        id: 'tx-review-categorized',
        account_uid: 'acc-review',
        amount: -6,
        currency: 'EUR',
        credit_debit: 'DBIT',
        booking_date: '2026-09-02',
        value_date: '2026-09-02',
        description: 'Netflix',
        counterparty: null,
        status: 'BOOK',
      },
      {
        id: 'tx-review-other-month',
        account_uid: 'acc-review',
        amount: -7,
        currency: 'EUR',
        credit_debit: 'DBIT',
        booking_date: '2026-10-01',
        value_date: '2026-10-01',
        description: 'Other month',
        counterparty: null,
        status: 'BOOK',
      },
    ]);
    setTransactionCategory('tx-review-categorized', 'cat-netflix-id', 0.9);

    const septAll = listBankTransactions({ monthYear: '2026-09' });
    expect(septAll.map((r) => r.id).sort()).toEqual(['tx-review-categorized', 'tx-review-uncategorized']);

    const septUncategorized = listBankTransactions({ monthYear: '2026-09', status: 'uncategorized' });
    expect(septUncategorized.map((r) => r.id)).toEqual(['tx-review-uncategorized']);

    const allUncategorized = listBankTransactions({ status: 'uncategorized' });
    expect(allUncategorized.some((r) => r.id === 'tx-review-other-month')).toBe(true);
    expect(allUncategorized.some((r) => r.id === 'tx-review-categorized')).toBe(false);
  });

  it('setTransactionIgnored marks a transaction ignored, and listBankTransactions(uncategorized) excludes it', () => {
    upsertTransactions([
      {
        id: 'tx-ignore-me',
        account_uid: 'acc-ignore',
        amount: -50,
        currency: 'EUR',
        credit_debit: 'DBIT',
        booking_date: '2026-09-10',
        value_date: '2026-09-10',
        description: 'Revolut top-up',
        counterparty: 'Revolut',
        status: 'BOOK',
      },
    ]);

    // Before ignoring, it's a normal member of the uncategorized queue.
    expect(
      listBankTransactions({ monthYear: '2026-09', status: 'uncategorized' }).some((r) => r.id === 'tx-ignore-me'),
    ).toBe(true);

    const updated = setTransactionIgnored('tx-ignore-me', true);
    expect(updated.ignored).toBe(1);
    expect(updated.category_id).toBeNull(); // ignoring never assigns a category

    const stillUncategorized = listBankTransactions({ monthYear: '2026-09', status: 'uncategorized' });
    expect(stillUncategorized.some((r) => r.id === 'tx-ignore-me')).toBe(false);

    // Un-ignoring brings it back into the queue.
    const unignored = setTransactionIgnored('tx-ignore-me', false);
    expect(unignored.ignored).toBe(0);
    expect(
      listBankTransactions({ monthYear: '2026-09', status: 'uncategorized' }).some((r) => r.id === 'tx-ignore-me'),
    ).toBe(true);
  });

  it('setTransactionIgnored throws for an unknown transaction id', () => {
    expect(() => setTransactionIgnored('does-not-exist', true)).toThrow(/not found/i);
  });

  it('bankSpentByCategory sums only booked + categorized transactions in-month, rounded to 2dp', () => {
    upsertTransactions([
      {
        id: 'tx-spent-1',
        account_uid: 'acc-spent',
        amount: -10.005,
        currency: 'EUR',
        credit_debit: 'DBIT',
        booking_date: '2026-11-03',
        value_date: '2026-11-03',
        description: 'Shop A',
        counterparty: null,
        status: 'BOOK',
      },
      {
        id: 'tx-spent-2',
        account_uid: 'acc-spent',
        amount: -5.0,
        currency: 'EUR',
        credit_debit: 'DBIT',
        booking_date: '2026-11-20',
        value_date: '2026-11-20',
        description: 'Shop B',
        counterparty: null,
        status: 'BOOK',
      },
      // Uncategorized — must not count.
      {
        id: 'tx-spent-uncategorized',
        account_uid: 'acc-spent',
        amount: -100,
        currency: 'EUR',
        credit_debit: 'DBIT',
        booking_date: '2026-11-10',
        value_date: '2026-11-10',
        description: 'Not yet categorized',
        counterparty: null,
        status: 'BOOK',
      },
      // Different month — must not count.
      {
        id: 'tx-spent-other-month',
        account_uid: 'acc-spent',
        amount: -50,
        currency: 'EUR',
        credit_debit: 'DBIT',
        booking_date: '2026-12-03',
        value_date: '2026-12-03',
        description: 'Shop A',
        counterparty: null,
        status: 'BOOK',
      },
    ]);
    setTransactionCategory('tx-spent-1', 'cat-shop-id', 0.9);
    setTransactionCategory('tx-spent-2', 'cat-shop-id', 0.9);
    setTransactionCategory('tx-spent-other-month', 'cat-shop-id', 0.9);

    const spent = bankSpentByCategory(2026, 11);
    expect(spent['cat-shop-id']).toBeCloseTo(15.01, 2);
    expect(Object.keys(spent)).toEqual(['cat-shop-id']);
  });
});
