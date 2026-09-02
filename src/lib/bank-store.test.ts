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
  bankSpentAnomalies,
  applyDedupDecisions,
  applyMonthAttributions,
  listUnallocated,
  setJointAccountUids,
  addBankCategoryRule,
  listBankCategoryRules,
  removeBankCategoryRule,
  createReviewQuestion,
  getReviewQuestionById,
  listPendingReviewQuestions,
  claimReviewQuestion,
  expireStaleReviewQuestions,
  listAskCandidates,
  type BankTransactionInput,
} from './bank-store';
import { initBudgetSchema, seedBudgetIfEmpty, createNextMonth, getMonthByYM } from './budget-store';
import { getDb } from './db';

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
    // The joint-only model: bankSpentByCategory scopes to the joint account
    // uid(s). These rows live on 'acc-spent', so mark it the joint account.
    setJointAccountUids(['acc-spent']);
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

  // ----- wave 2d: unallocated (allocation-only model) -----

  it('applyDedupDecisions persists the unallocated flag; listUnallocated returns only those rows, filterable by month', () => {
    upsertTransactions([
      {
        id: 'un-tesco',
        account_uid: 'acc-un',
        amount: -14.35,
        currency: 'EUR',
        credit_debit: 'DBIT',
        booking_date: '2027-03-03',
        value_date: '2027-03-03',
        description: 'Tesco Stores',
        counterparty: null,
        status: 'BOOK',
      },
      {
        id: 'un-vercel',
        account_uid: 'acc-un',
        amount: -20,
        currency: 'EUR',
        credit_debit: 'DBIT',
        booking_date: '2027-04-03',
        value_date: '2027-04-03',
        description: 'Vercel Inc',
        counterparty: null,
        status: 'BOOK',
      },
      {
        id: 'un-alloc',
        account_uid: 'acc-un',
        amount: -138,
        currency: 'EUR',
        credit_debit: 'DBIT',
        booking_date: '2027-03-04',
        value_date: '2027-03-04',
        description: 'Gym From RAFAEL',
        counterparty: null,
        status: 'BOOK',
      },
    ]);
    applyDedupDecisions([
      { id: 'un-tesco', counted: 0, dedup_group: null, unallocated: 1 },
      { id: 'un-vercel', counted: 0, dedup_group: null, unallocated: 1 },
      { id: 'un-alloc', counted: 1, dedup_group: null, unallocated: 0 },
    ]);

    const all = listUnallocated().map((r) => r.id).sort();
    expect(all).toEqual(['un-tesco', 'un-vercel']);
    expect(all).not.toContain('un-alloc');

    // Month filter is on budget_month (= booking month for unallocated rows).
    const march = listUnallocated({ month: '2027-03' }).map((r) => r.id);
    expect(march).toEqual(['un-tesco']);
  });

  it('bankSpentAnomalies flags a still-positive category whose returns exceeded the review threshold (HIGH-B widening)', () => {
    setJointAccountUids(['acc-anom']);
    upsertTransactions([
      {
        id: 'anom-out',
        account_uid: 'acc-anom',
        amount: -200,
        currency: 'EUR',
        credit_debit: 'DBIT',
        booking_date: '2027-05-05',
        value_date: '2027-05-05',
        description: 'Insurance',
        counterparty: null,
        status: 'BOOK',
      },
      {
        id: 'anom-return',
        account_uid: 'acc-anom',
        amount: 190,
        currency: 'EUR',
        credit_debit: 'CRDT',
        booking_date: '2027-05-06',
        value_date: '2027-05-06',
        description: 'Insurance refund',
        counterparty: null,
        status: 'BOOK',
      },
    ]);
    setTransactionCategory('anom-out', 'cat-anom');
    setTransactionCategory('anom-return', 'cat-anom');

    // Net stays positive (200 − 190 = 10), so it is NOT clamped to 0...
    expect(bankSpentByCategory(2027, 5)['cat-anom']).toBeCloseTo(10, 2);
    // ...but the €190 of returns quietly reduced the total, so it's surfaced.
    expect(bankSpentAnomalies(2027, 5)).toContain('cat-anom');
  });

  // ----- applyMonthAttributions: stale-category-clear path -----

  it('applyMonthAttributions clears a stale category_id when the target month has no matching category id (noCat/categoryIsForOtherMonth), and resets counted/unallocated', () => {
    // Category ids are per-month UUIDs (createNextMonth mints fresh ones even
    // for a same-named category), so a category_id assigned under one month is
    // provably wrong for another month — this is the caller-omits-categoryId
    // path runAttribution takes when its by-name lookup for the target month
    // misses (e.g. a category with no plan there).
    initBudgetSchema();
    seedBudgetIfEmpty(); // Aug/2026, incl. a "Gym" category
    createNextMonth(); // Sep/2026 — same category names, but fresh per-month ids
    const augGymId = getMonthByYM(2026, 8)!.categories.find((c) => c.name === 'Gym')!.id;

    upsertTransactions([
      {
        id: 'tx-stale-cat',
        account_uid: 'acc-stale',
        amount: -138,
        currency: 'EUR',
        credit_debit: 'DBIT',
        booking_date: '2026-08-05',
        value_date: '2026-08-05',
        description: 'Gym',
        counterparty: null,
        status: 'BOOK',
      },
    ]);
    setTransactionCategory('tx-stale-cat', augGymId);

    // Re-attribute to September without supplying a target categoryId — August's
    // Gym id is provably wrong for September (September's own Gym has a
    // different id), so this must clear it rather than leave it dangling.
    applyMonthAttributions([{ id: 'tx-stale-cat', budget_month: '2026-09', move_reason: 'test move' }]);

    const after = listTransactions().find((r) => r.id === 'tx-stale-cat')!;
    expect(after.category_id).toBeNull();
    expect(after.budget_month).toBe('2026-09');
    expect(after.counted).toBe(0);
    expect(after.unallocated).toBe(1);

    // Reappears in the uncategorized review queue.
    expect(listBankTransactions({ status: 'uncategorized' }).map((r) => r.id)).toContain('tx-stale-cat');
  });

  // ----- bank_category_rules -----

  it('bank_category_rules exists after init and round-trips add (pattern normalized) / list / remove', () => {
    // initBankSchema ran in beforeAll — the table must exist on it.
    const tables = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bank_category_rules'")
      .all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).toContain('bank_category_rules');

    const rule = addBankCategoryRule({ pattern: 'Clúid Housing Association', category_name: 'Rental' });
    expect(rule.match_field).toBe('counterparty');
    expect(rule.pattern).toBe('cluid housing association'); // stored PRE-NORMALIZED
    expect(rule.category_name).toBe('Rental');

    const listed = listBankCategoryRules();
    expect(listed.some((r) => r.id === rule.id && r.pattern === 'cluid housing association')).toBe(true);

    removeBankCategoryRule(rule.id);
    expect(listBankCategoryRules().some((r) => r.id === rule.id)).toBe(false);
  });

  it('addBankCategoryRule rejects a pattern that normalizes to empty', () => {
    expect(() => addBankCategoryRule({ pattern: 'To RAFAEL', category_name: 'Rental' })).toThrow();
  });

  it('addBankCategoryRule rejects a pattern that normalizes shorter than 3 chars', () => {
    expect(() => addBankCategoryRule({ pattern: 'Zz', category_name: 'Rental' })).toThrow();
  });

  // ----- wave 2e: review questions (WhatsApp ask/answer) -----

  it('bank_review_questions schema is created by initBankSchema with the expected columns', () => {
    const cols = getDb()
      .prepare('PRAGMA table_info(bank_review_questions)')
      .all() as Array<{ name: string; type: string; notnull: number }>;
    const names = cols.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'id',
        'tx_id',
        'tx_date',
        'tx_description',
        'tx_amount',
        'asked_at',
        'status',
        'answered_by',
        'answered_at',
        'chosen_category_id',
        'answer_text',
      ]),
    );
    const statusCol = cols.find((c) => c.name === 'status')!;
    // SQLite stores CHECK constraints outside PRAGMA table_info, but the
    // column itself is NOT NULL with default 'pending'.
    expect(statusCol.notnull).toBe(1);
  });

  it('createReviewQuestion: pending row is reused (no new message), answered row returns null, expired row is revived, missing row inserts', () => {
    const base = {
      tx_id: 'tx-rq-1',
      tx_date: '2026-08-05',
      tx_description: 'Tesco',
      tx_amount: -42.5,
    };

    // 1. not-exists -> insert (sent=true)
    const first = createReviewQuestion(base);
    expect(first).not.toBeNull();
    expect(first!.sent).toBe(true);
    expect(first!.row.status).toBe('pending');
    expect(first!.row.tx_id).toBe(base.tx_id);
    const firstId = first!.row.id;

    // 2. pending -> reuse, same id, no new message
    const second = createReviewQuestion(base);
    expect(second).not.toBeNull();
    expect(second!.sent).toBe(false);
    expect(second!.row.id).toBe(firstId);
    expect(second!.row.status).toBe('pending');

    // 3. claim it as answered -> next call returns null
    expect(claimReviewQuestion(firstId, 'rafa', 'Shop', 'cat-shop-id')).toBe(true);
    const third = createReviewQuestion(base);
    expect(third).toBeNull();

    // 4. force-expire then re-create -> revive with fresh asked_at, sent=true
    //    (manipulate asked_at to be in the past so expireStaleReviewQuestions
    //    picks it up — the row's status is still 'answered' until claim
    //    resets it; for a clean "expired -> revive" case we need a row whose
    //    status was set to 'expired' by the sweep.)
    getDb()
      .prepare("UPDATE bank_review_questions SET status = 'expired', answered_at = NULL WHERE id = ?")
      .run(firstId);
    const fourth = createReviewQuestion({ ...base, tx_id: 'tx-rq-1', tx_date: '2026-08-05' });
    expect(fourth).not.toBeNull();
    expect(fourth!.sent).toBe(true);
    expect(fourth!.row.status).toBe('pending');
    expect(fourth!.row.id).toBe(firstId);
    expect(new Date(fourth!.row.asked_at).getTime()).toBeGreaterThanOrEqual(Date.now() - 2000);
  });

  it('claimReviewQuestion is atomic first-writer-wins — a second claimer returns false and the row keeps the first claim', () => {
    createReviewQuestion({
      tx_id: 'tx-rq-race',
      tx_date: '2026-08-10',
      tx_description: 'Netflix',
      tx_amount: -12.99,
    });
    const row = listPendingReviewQuestions(100).find((r) => r.tx_id === 'tx-rq-race')!;

    const first = claimReviewQuestion(row.id, 'rafa', 'Shop', 'cat-shop-id');
    expect(first).toBe(true);

    const second = claimReviewQuestion(row.id, 'rafaela', 'Other', 'cat-other-id');
    expect(second).toBe(false);

    const after = getReviewQuestionById(row.id)!;
    expect(after.status).toBe('answered');
    expect(after.answered_by).toBe('rafa');
    expect(after.chosen_category_id).toBe('cat-shop-id');
    expect(after.answer_text).toBe('Shop');
  });

  it('listPendingReviewQuestions orders by asked_at ASC and respects the limit', async () => {
    // Isolate from earlier tests' leftover pending rows so the limit assert
    // sees exactly the three rows this test creates.
    getDb().exec('DELETE FROM bank_review_questions');
    createReviewQuestion({ tx_id: 'tx-rq-ord-a', tx_date: '2026-08-01', tx_description: 'A', tx_amount: -1 });
    // small gap so asked_at strictly increases
    await new Promise((r) => setTimeout(r, 5));
    createReviewQuestion({ tx_id: 'tx-rq-ord-b', tx_date: '2026-08-02', tx_description: 'B', tx_amount: -2 });
    await new Promise((r) => setTimeout(r, 5));
    createReviewQuestion({ tx_id: 'tx-rq-ord-c', tx_date: '2026-08-03', tx_description: 'C', tx_amount: -3 });
    const all = listPendingReviewQuestions(100).filter((r) =>
      ['tx-rq-ord-a', 'tx-rq-ord-b', 'tx-rq-ord-c'].includes(r.tx_id),
    );
    expect(all.map((r) => r.tx_id)).toEqual(['tx-rq-ord-a', 'tx-rq-ord-b', 'tx-rq-ord-c']);
    expect(listPendingReviewQuestions(2).map((r) => r.tx_id)).toEqual(['tx-rq-ord-a', 'tx-rq-ord-b']);
  });

  it('expireStaleReviewQuestions moves pending rows older than 24h to expired and leaves fresh ones alone', () => {
    const db = getDb();
    // Insert a stale pending row directly.
    const stale = 'tx-rq-stale';
    createReviewQuestion({ tx_id: stale, tx_date: '2026-07-01', tx_description: 'Old', tx_amount: -5 });
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE bank_review_questions SET asked_at = ? WHERE tx_id = ?').run(oldDate, stale);
    // Insert a fresh pending row.
    createReviewQuestion({ tx_id: 'tx-rq-fresh', tx_date: '2026-08-10', tx_description: 'New', tx_amount: -7 });

    const staleRow = listPendingReviewQuestions(100).find((r) => r.tx_id === stale)!;
    const staleId = staleRow.id;

    const expired = expireStaleReviewQuestions();
    expect(expired).toBeGreaterThanOrEqual(1);

    // The stale row left the pending list (now 'expired').
    expect(getReviewQuestionById(staleId)!.status).toBe('expired');
    expect(listPendingReviewQuestions(100).find((r) => r.tx_id === stale)).toBeUndefined();
    const fresh = listPendingReviewQuestions(100).find((r) => r.tx_id === 'tx-rq-fresh');
    expect(fresh).toBeDefined();
    // The stale row is in 'expired' status — re-creating should revive it.
    const revived = createReviewQuestion({ tx_id: stale, tx_date: '2026-07-01', tx_description: 'Old', tx_amount: -5 });
    expect(revived).not.toBeNull();
    expect(revived!.sent).toBe(true);
    expect(revived!.row.status).toBe('pending');
  });

  it('listAskCandidates returns unallocated + (category_id IS NULL OR confidence < 0.9), scoped to the monthKeys, capped at limit', () => {
    // Isolate: earlier tests leave unallocated rows (e.g. tx-stale-cat) booked
    // in the current month that would legitimately show up as candidates.
    getDb().exec('DELETE FROM bank_transactions');
    const joint = 'acc-ask-joint';
    setJointAccountUids([joint]);
    const ym = new Date().toISOString().slice(0, 7); // current month
    const other = ym === '2026-08' ? '2026-09' : '2026-08';
    // Earlier tests seed Aug/2026 with per-month UUID category ids — use a real
    // id when the current month exists so setTransactionCategory's guard passes.
    const month = getMonthByYM(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)));
    const shopCatId = month?.categories.find((c) => c.name === 'Shop')?.id ?? 'cat-shop';

    upsertTransactions([
      {
        id: 'tx-ask-confident',
        account_uid: joint,
        amount: -10,
        currency: 'EUR',
        credit_debit: 'DBIT',
        booking_date: `${ym}-05`,
        value_date: `${ym}-05`,
        description: 'Some Shop',
        counterparty: null,
        status: 'BOOK',
      },
      {
        id: 'tx-ask-lowconf',
        account_uid: joint,
        amount: -20,
        currency: 'EUR',
        credit_debit: 'DBIT',
        booking_date: `${ym}-06`,
        value_date: `${ym}-06`,
        description: 'Some Shop',
        counterparty: null,
        status: 'BOOK',
      },
      {
        id: 'tx-ask-nullcat',
        account_uid: joint,
        amount: -30,
        currency: 'EUR',
        credit_debit: 'DBIT',
        booking_date: `${ym}-07`,
        value_date: `${ym}-07`,
        description: 'Some Shop',
        counterparty: null,
        status: 'BOOK',
      },
      {
        id: 'tx-ask-other-month',
        account_uid: joint,
        amount: -40,
        currency: 'EUR',
        credit_debit: 'DBIT',
        booking_date: `${other}-05`,
        value_date: `${other}-05`,
        description: 'Some Shop',
        counterparty: null,
        status: 'BOOK',
      },
      {
        id: 'tx-ask-allocated',
        account_uid: joint,
        amount: -50,
        currency: 'EUR',
        credit_debit: 'DBIT',
        booking_date: `${ym}-08`,
        value_date: `${ym}-08`,
        description: 'Some Shop',
        counterparty: null,
        status: 'BOOK',
      },
    ]);
    // Mark a few as unallocated via the dedup path so the flag sticks.
    applyDedupDecisions([
      { id: 'tx-ask-lowconf', counted: 0, dedup_group: null, unallocated: 1 },
      { id: 'tx-ask-nullcat', counted: 0, dedup_group: null, unallocated: 1 },
      { id: 'tx-ask-other-month', counted: 0, dedup_group: null, unallocated: 1 },
      { id: 'tx-ask-allocated', counted: 1, dedup_group: null, unallocated: 0 },
      { id: 'tx-ask-confident', counted: 0, dedup_group: null, unallocated: 1 },
    ]);
    setTransactionCategory('tx-ask-confident', shopCatId, 0.95); // >=0.9
    setTransactionCategory('tx-ask-lowconf', shopCatId, 0.6); // <0.9

    const candidates = listAskCandidates([ym], 10).map((r) => r.id).sort();
    // tx-ask-confident is unallocated but confidence >=0.9 -> excluded
    // tx-ask-lowconf is unallocated + confidence 0.6 -> included
    // tx-ask-nullcat is unallocated + category_id NULL -> included
    // tx-ask-other-month is outside the window -> excluded
    // tx-ask-allocated is allocated (unallocated=0) -> excluded
    expect(candidates).toEqual(['tx-ask-lowconf', 'tx-ask-nullcat']);

    const all = listAskCandidates([ym, other], 100).map((r) => r.id).sort();
    expect(all).toEqual(['tx-ask-lowconf', 'tx-ask-nullcat', 'tx-ask-other-month']);
  });
});
