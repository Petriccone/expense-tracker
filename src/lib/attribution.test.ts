// Tests for the intelligence layer (attribution.ts) under the joint-only
// signed-net model (confirmed 2026-08-16). Pure unit tests for the two building
// blocks (internal-transfer classification, plan-aware month attribution) plus
// DB-backed end-to-end tests through runAttribution + bankSpentByCategory on
// real SQLite in a temp dir (same PETRICCO_DATA_DIR pattern as
// bank-store.test.ts).
//
// The model: per (category, budget_month) the bank spend is the NET SIGNED FLOW
// in the JOINT account only. A JOINT-account row counts iff it is an INTERNAL
// labeled transfer (counterparty is the couple, or a self-transfer) AND its
// label matched a budget category; a DBIT (money leaving the joint account)
// ADDS, a CRDT (a return) SUBTRACTS. Personal-account rows and external
// merchants/credits never touch category spend.

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDb } from './db';
import {
  initBankSchema,
  upsertTransactions,
  setTransactionCategory,
  getTransactionById,
  bankSpentByCategory,
  bankSpentAnomalies,
  listUnallocated,
  setJointAccountUids,
  isInternalTransfer,
  addBankCategoryRule,
  type BankTransactionInput,
} from './bank-store';
import { initBudgetSchema, seedBudgetIfEmpty, createNextMonth, getMonthByYM } from './budget-store';
import {
  attributeMonths,
  salaryDaysByMonth,
  runAttribution,
  type AttributionTxInput,
  type PlannedByCategoryMonth,
} from './attribution';

// The couple's real account-holder names — a counterparty carrying one of these
// (as a contiguous phrase) marks a transaction INTERNAL (their own money).
const RAFAEL = 'Rafael Petriccone';
const RAFAELA = 'Rafaela François';
const JOINT = 'acc-joint';
const PERSONAL = 'acc-personal';

// ----- pure: isInternalTransfer -----

describe('isInternalTransfer (pure)', () => {
  it('classes a couple member (full name, either field) as INTERNAL', () => {
    expect(isInternalTransfer({ counterparty: RAFAEL, description: 'Gym To RAFAEL' })).toBe(true);
    expect(isInternalTransfer({ counterparty: 'RAFAELA FRANCOIS', description: 'x' })).toBe(true);
    // Long form (with middle names) still matches.
    expect(isInternalTransfer({ counterparty: 'Rafael dos Santos Petriccone', description: '' })).toBe(true);
  });

  it('classes a self-transfer descriptor (arrow / bare account label) as INTERNAL', () => {
    // The arrow SHAPE only qualifies alone in its own field (the OTHER field
    // empty) — see the field-split-spoof test below for the paired-field case.
    expect(isInternalTransfer({ counterparty: 'Joint → Personal', description: '' })).toBe(true);
    expect(isInternalTransfer({ counterparty: null, description: 'Joint -> Personal' })).toBe(true);
    expect(isInternalTransfer({ counterparty: 'Personal', description: 'Insurance' })).toBe(true);
  });

  it('does NOT trust the arrow shape when the OTHER field carries a real label — field-split spoof (security MEDIUM)', () => {
    // A spoofed "Joint -> Personal" in counterparty paired with a real category
    // name ("Shop") in description must NOT classify internal: categorize.ts's
    // matchLabel reads description/counterparty independently, so this pairing
    // would otherwise let an external inbound credit borrow the arrow's internal
    // signal while its description matches a real budget category.
    expect(isInternalTransfer({ counterparty: 'Joint -> Personal', description: 'Shop' })).toBe(false);
    // Same spoof, fields swapped.
    expect(isInternalTransfer({ counterparty: 'Shop', description: 'Joint -> Personal' })).toBe(false);
  });

  it('classes a merchant / external person as EXTERNAL', () => {
    expect(isInternalTransfer({ counterparty: 'Tesco Stores', description: 'Tesco Stores 6913' })).toBe(false);
    expect(isInternalTransfer({ counterparty: 'Some Person', description: 'Gym From SOMEONE' })).toBe(false);
    expect(isInternalTransfer({ counterparty: null, description: 'NETFLIX.COM' })).toBe(false);
  });

  it('does NOT class a merchant named "Shop Dos Santos" as internal (no single-token match)', () => {
    // The joint account name is "RAFAEL DOS SANTOS PETRICCONE ..." — the OLD
    // single-token classifier flagged any "dos"/"santos" merchant as internal
    // and double-counted it. Full-phrase matching fixes that.
    expect(isInternalTransfer({ counterparty: 'Shop Dos Santos', description: 'Shop Dos Santos' })).toBe(false);
  });

  it('does NOT class a merchant containing the word "Personal" as internal (exact-label only)', () => {
    // "Personal Trainer" normalizes to "personal trainer" != the bare label
    // "personal", so it stays external.
    expect(isInternalTransfer({ counterparty: 'Personal Trainer Dublin', description: 'x' })).toBe(false);
  });

  it('anchors the arrow rule to a self-transfer SHAPE — a bare "->" in free text is NOT internal (HIGH-A)', () => {
    // An inbound credit whose payer-controlled memo merely contains "->" must
    // stay external — otherwise, being a CRDT, it could subtract from a category.
    expect(isInternalTransfer({ counterparty: 'Some Person', description: 'Shop -> reembolso' })).toBe(false);
    // The genuine account→account shape still classifies internal (alone in its
    // own field).
    expect(isInternalTransfer({ counterparty: 'Joint -> Personal', description: '' })).toBe(true);
  });

  it('does NOT class a different person whose name EXTENDS a holder name as internal (MED-3)', () => {
    // Whole-token (word-sequence) match, not a padded substring: 'Rafael
    // Petriccone' must NOT match a different person's 'Rafael Petriccone Neto'.
    expect(isInternalTransfer({ counterparty: 'Rafael Petriccone Neto', description: '' })).toBe(false);
    // The exact holder name still matches.
    expect(isInternalTransfer({ counterparty: 'Rafael Petriccone', description: '' })).toBe(true);
  });
});

// ----- pure: attributeMonths -----

describe('attributeMonths (pure)', () => {
  const planned: PlannedByCategoryMonth = { Gym: { '2026-08': 138, '2026-09': 138 } };
  const byId = (rs: ReturnType<typeof attributeMonths>) => new Map(rs.map((r) => [r.id, r]));

  it('rolls the second same-category outflow to the next month once the plan is met', () => {
    const txs: AttributionTxInput[] = [
      { id: 't1', category: 'Gym', amount: 138, bookingDate: '2026-08-10' },
      { id: 't2', category: 'Gym', amount: 138, bookingDate: '2026-08-20' },
    ];
    const rs = byId(attributeMonths(txs, planned));

    expect(rs.get('t1')!.budgetMonth).toBe('2026-08');
    expect(rs.get('t1')!.moveReason).toBeNull();

    expect(rs.get('t2')!.budgetMonth).toBe('2026-09');
    expect(rs.get('t2')!.moveReason).toMatch(/Ago.*Gym.*Set/);
    expect(rs.get('t2')!.review).toBe(false);
  });

  it('keeps two partial outflows that together equal planned in the same month', () => {
    const txs: AttributionTxInput[] = [
      { id: 'a', category: 'Gym', amount: 100, bookingDate: '2026-08-05' },
      { id: 'b', category: 'Gym', amount: 38, bookingDate: '2026-08-15' },
    ];
    const rs = byId(attributeMonths(txs, planned));
    expect(rs.get('a')!.budgetMonth).toBe('2026-08');
    expect(rs.get('b')!.budgetMonth).toBe('2026-08');
  });

  it('a RETURN (negative) nets against its month and never rolls forward', () => {
    // Aug plan is met by the first outflow; the return must NOT roll to Sep — it
    // reverses August's spend, so it stays in August.
    const txs: AttributionTxInput[] = [
      { id: 'out', category: 'Gym', amount: 138, bookingDate: '2026-08-05' },
      { id: 'ret', category: 'Gym', amount: -138, bookingDate: '2026-08-06' },
    ];
    const rs = byId(attributeMonths(txs, planned));
    expect(rs.get('out')!.budgetMonth).toBe('2026-08');
    expect(rs.get('ret')!.budgetMonth).toBe('2026-08');
    expect(rs.get('ret')!.review).toBe(false);
  });

  it('does NOT force a move when the category has no plan that month — flags review', () => {
    const txs: AttributionTxInput[] = [{ id: 'x', category: 'Mystery', amount: 50, bookingDate: '2026-08-05' }];
    const rs = byId(attributeMonths(txs, planned));
    expect(rs.get('x')!.budgetMonth).toBe('2026-08');
    expect(rs.get('x')!.review).toBe(true);
  });

  it('does NOT roll forward into a month that itself has no plan — flags review instead', () => {
    const augOnly: PlannedByCategoryMonth = { Gym: { '2026-08': 138 } };
    const txs: AttributionTxInput[] = [
      { id: 't1', category: 'Gym', amount: 138, bookingDate: '2026-08-10' },
      { id: 't2', category: 'Gym', amount: 138, bookingDate: '2026-08-20' },
    ];
    const rs = byId(attributeMonths(txs, augOnly));
    expect(rs.get('t1')!.budgetMonth).toBe('2026-08');
    expect(rs.get('t2')!.budgetMonth).toBe('2026-08');
    expect(rs.get('t2')!.review).toBe(true);
  });

  it('recurses across multiple already-met months', () => {
    const threeMonths: PlannedByCategoryMonth = { Gym: { '2026-08': 138, '2026-09': 138, '2026-10': 138 } };
    const txs: AttributionTxInput[] = [
      { id: 't1', category: 'Gym', amount: 138, bookingDate: '2026-08-05' },
      { id: 't2', category: 'Gym', amount: 138, bookingDate: '2026-08-10' },
      { id: 't3', category: 'Gym', amount: 138, bookingDate: '2026-08-15' },
    ];
    const rs = byId(attributeMonths(txs, threeMonths));
    expect(rs.get('t1')!.budgetMonth).toBe('2026-08');
    expect(rs.get('t2')!.budgetMonth).toBe('2026-09');
    expect(rs.get('t3')!.budgetMonth).toBe('2026-10');
  });
});

// ----- pure: salaryDaysByMonth + the salary-day attribution rule -----

describe('salaryDaysByMonth (pure)', () => {
  it('picks the LATEST CRDT salary booking per month, ignoring debits and non-salary credits', () => {
    const days = salaryDaysByMonth([
      { credit_debit: 'CRDT', booking_date: '2026-07-28', description: 'Salary El To RAFAEL', amount: 2942.31 },
      { credit_debit: 'CRDT', booking_date: '2026-07-31', description: 'Salary Ela', amount: 2855.83 },
      { credit_debit: 'DBIT', booking_date: '2026-07-15', description: 'salary clawback', amount: -500 },
      { credit_debit: 'CRDT', booking_date: '2026-07-20', description: 'Tesco refund', amount: 12.5 },
      { credit_debit: 'CRDT', booking_date: '2026-08-27', description: 'SALARY El', amount: 2942.31 },
    ]);
    expect(days['2026-07']).toBe('2026-07-31');
    expect(days['2026-08']).toBe('2026-08-27');
  });

  it('ignores a sub-threshold "salary" credit so a tiny injected one cannot move the payday (review sec-1)', () => {
    const days = salaryDaysByMonth([
      { credit_debit: 'CRDT', booking_date: '2026-06-25', description: 'Salary El To RAFAEL', amount: 2000 },
      { credit_debit: 'CRDT', booking_date: '2026-06-28', description: 'salary', amount: 0.01 },
    ]);
    expect(days['2026-06']).toBe('2026-06-25');
  });

  it('warns when the detected salary day is unusually early — before day 20 (review corr-3)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const days = salaryDaysByMonth([
        { credit_debit: 'CRDT', booking_date: '2026-05-12', description: 'Salary El', amount: 2500 },
      ]);
      expect(days['2026-05']).toBe('2026-05-12');
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('attributeMonths — salary-day rule (pure)', () => {
  const planned: PlannedByCategoryMonth = { MacBook: { '2026-07': 92.23, '2026-08': 92.23 } };
  const byId = (rs: ReturnType<typeof attributeMonths>) => new Map(rs.map((r) => [r.id, r]));

  it('attributes an outflow booked ON the salary day to the NEXT month (payday distribution)', () => {
    const salaryDayByMonth = { '2026-07': '2026-07-31' };
    const txs: AttributionTxInput[] = [{ id: 'mb', category: 'MacBook', amount: 92.23, bookingDate: '2026-07-31' }];
    const rs = byId(attributeMonths(txs, planned, { salaryDayByMonth }));
    expect(rs.get('mb')!.budgetMonth).toBe('2026-08');
    expect(rs.get('mb')!.moveReason).toMatch(/salário/i);
  });

  it('keeps an outflow booked BEFORE the salary day in the current month', () => {
    const salaryDayByMonth = { '2026-07': '2026-07-31' };
    const txs: AttributionTxInput[] = [{ id: 'mb', category: 'MacBook', amount: 92.23, bookingDate: '2026-07-10' }];
    const rs = byId(attributeMonths(txs, planned, { salaryDayByMonth }));
    expect(rs.get('mb')!.budgetMonth).toBe('2026-07');
    expect(rs.get('mb')!.moveReason).toBeNull();
  });

  it('falls back to "last 5 days of the month -> next month" when no salary day is known', () => {
    const txs: AttributionTxInput[] = [{ id: 'mb', category: 'MacBook', amount: 92.23, bookingDate: '2026-07-31' }];
    const rs = byId(attributeMonths(txs, planned, {}));
    expect(rs.get('mb')!.budgetMonth).toBe('2026-08');
  });
});

// ----- DB-backed: runAttribution + bankSpentByCategory -----

describe('runAttribution (DB-backed, real SQLite)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attribution-test-'));

  const bookedTx = (
    over: Partial<BankTransactionInput> &
      Pick<BankTransactionInput, 'id' | 'account_uid' | 'amount' | 'credit_debit' | 'booking_date' | 'description'>,
  ): BankTransactionInput => ({
    currency: 'EUR',
    value_date: over.booking_date,
    counterparty: null,
    status: 'BOOK',
    ...over,
  });

  beforeAll(() => {
    process.env.PETRICCO_DATA_DIR = tmpDir;
    initBankSchema();
    initBudgetSchema();
  });

  afterAll(() => {
    delete process.env.PETRICCO_DATA_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    const db = getDb();
    db.exec(
      'DELETE FROM bank_transactions;' +
        'DELETE FROM bank_sessions;' +
        'DELETE FROM bank_settings;' +
        'DELETE FROM budget_categories;' +
        'DELETE FROM budget_incomes;' +
        'DELETE FROM budget_months;' +
        'DELETE FROM budget_settings;',
    );
    // bank_settings was just wiped — (re)mark the joint account for every test.
    setJointAccountUids([JOINT]);
  });

  const catIdFor = (year: number, month: number, name: string): string => {
    const m = getMonthByYM(year, month);
    const cat = m?.categories.find((c) => c.name === name);
    if (!cat) throw new Error(`no ${name} category for ${year}-${month}`);
    return cat.id;
  };
  const gymIdFor = (year: number, month: number): string => catIdFor(year, month, 'Gym');

  it('nets an insurance reversal to €112.80 in the joint account (156 out, 156 back, 112.80 out)', () => {
    seedBudgetIfEmpty(); // Aug/2026 — Insurance planned 150
    const augInsurance = catIdFor(2026, 8, 'Insurance');

    // All three on the JOINT account. Line 1 is a self-transfer (Joint →
    // Personal) — the arrow lives alone in counterparty (description empty),
    // since the arrow signal only qualifies as internal when the OTHER field is
    // empty (security MEDIUM, field-split spoof guard); category is assigned
    // directly below, not via label matching, so the empty description doesn't
    // affect categorization here. Lines 2 & 3 are with the wife. The +156 return
    // cancels the −156 allocation; the −112.80 is the real net payment.
    upsertTransactions([
      bookedTx({ id: 'ins-out', account_uid: JOINT, amount: -156, credit_debit: 'DBIT', booking_date: '2026-08-10', description: '', counterparty: 'Joint → Personal' }),
      bookedTx({ id: 'ins-return', account_uid: JOINT, amount: 156, credit_debit: 'CRDT', booking_date: '2026-08-11', description: 'Car insurance', counterparty: RAFAELA }),
      bookedTx({ id: 'ins-out2', account_uid: JOINT, amount: -112.8, credit_debit: 'DBIT', booking_date: '2026-08-12', description: 'Car insurance', counterparty: RAFAELA }),
    ]);
    for (const id of ['ins-out', 'ins-return', 'ins-out2']) setTransactionCategory(id, augInsurance);

    runAttribution({ jointAccountUids: [JOINT] });

    expect(bankSpentByCategory(2026, 8)[augInsurance]).toBeCloseTo(112.8, 2);
    for (const id of ['ins-out', 'ins-return', 'ins-out2']) {
      expect(getTransactionById(id)!.counted).toBe(1);
    }
  });

  it('counts a single labeled Gym allocation once (€138)', () => {
    seedBudgetIfEmpty(); // Aug/2026 — Gym planned 138
    const augGym = gymIdFor(2026, 8);

    upsertTransactions([
      bookedTx({ id: 'gym', account_uid: JOINT, amount: -138, credit_debit: 'DBIT', booking_date: '2026-08-05', description: 'Gym', counterparty: RAFAEL }),
    ]);
    setTransactionCategory('gym', augGym);

    runAttribution({ jointAccountUids: [JOINT] });

    expect(bankSpentByCategory(2026, 8)[augGym]).toBeCloseTo(138, 2);
    expect(getTransactionById('gym')!.counted).toBe(1);
  });

  it('sums TWO genuinely-distinct same-day €17 Netflix DBITs to €34 — nothing dropped (de-dup removed)', () => {
    seedBudgetIfEmpty(); // Aug/2026 — Netflix planned 17
    const augNetflix = catIdFor(2026, 8, 'Netflix');

    // Same label, amount and date, both on the joint account. The OLD model
    // collapsed these to one (€17); the joint-only signed model keeps both.
    upsertTransactions([
      bookedTx({ id: 'nf-1', account_uid: JOINT, amount: -17, credit_debit: 'DBIT', booking_date: '2026-08-06', description: 'Netflix', counterparty: RAFAELA }),
      bookedTx({ id: 'nf-2', account_uid: JOINT, amount: -17, credit_debit: 'DBIT', booking_date: '2026-08-06', description: 'Netflix', counterparty: RAFAELA }),
    ]);
    for (const id of ['nf-1', 'nf-2']) setTransactionCategory(id, augNetflix);

    runAttribution({ jointAccountUids: [JOINT] });

    expect(bankSpentByCategory(2026, 8)[augNetflix]).toBeCloseTo(34, 2);
    expect(getTransactionById('nf-1')!.counted).toBe(1);
    expect(getTransactionById('nf-2')!.counted).toBe(1);
  });

  it('excludes an external merchant charge (Tesco Stores) even when it is categorized', () => {
    seedBudgetIfEmpty();
    const augShop = catIdFor(2026, 8, 'Shop');

    upsertTransactions([
      bookedTx({ id: 'tesco', account_uid: JOINT, amount: -14.35, credit_debit: 'DBIT', booking_date: '2026-08-12', description: 'Tesco Stores 6913', counterparty: 'Tesco Stores' }),
    ]);
    setTransactionCategory('tesco', augShop); // even categorized, external stays out

    runAttribution({ jointAccountUids: [JOINT] });

    const t = getTransactionById('tesco')!;
    expect(t.counted).toBe(0);
    expect(t.unallocated).toBe(1);
    expect(bankSpentByCategory(2026, 8)[augShop]).toBeUndefined();
  });

  it('an EXTERNAL inbound credit labeled like a category does NOT subtract from spend', () => {
    seedBudgetIfEmpty(); // Gym planned 138
    const augGym = gymIdFor(2026, 8);

    upsertTransactions([
      // A real internal Gym allocation: +138 spend.
      bookedTx({ id: 'gym-alloc', account_uid: JOINT, amount: -138, credit_debit: 'DBIT', booking_date: '2026-08-05', description: 'Gym', counterparty: RAFAELA }),
      // A stranger sends €50 with "Gym" in the remittance — must NOT reduce Gym.
      bookedTx({ id: 'ext-credit', account_uid: JOINT, amount: 50, credit_debit: 'CRDT', booking_date: '2026-08-07', description: 'Gym From SOMEONE', counterparty: 'Some Person' }),
    ]);
    setTransactionCategory('gym-alloc', augGym);
    setTransactionCategory('ext-credit', augGym);

    runAttribution({ jointAccountUids: [JOINT] });

    // €138, NOT €88 — the external credit is excluded, not subtracted.
    expect(bankSpentByCategory(2026, 8)[augGym]).toBeCloseTo(138, 2);
    const ext = getTransactionById('ext-credit')!;
    expect(ext.counted).toBe(0);
    expect(ext.unallocated).toBe(1);
    expect(listUnallocated({ month: '2026-08' }).map((r) => r.id)).toContain('ext-credit');
  });

  it('does NOT classify a merchant named "Shop Dos Santos" as internal — no double-count', () => {
    seedBudgetIfEmpty();
    const augShop = catIdFor(2026, 8, 'Shop');

    upsertTransactions([
      // The real Shop allocation.
      bookedTx({ id: 'shop-alloc', account_uid: JOINT, amount: -650, credit_debit: 'DBIT', booking_date: '2026-08-05', description: 'Shop', counterparty: RAFAELA }),
      // A merchant literally named "Shop Dos Santos" — external, must not count.
      bookedTx({ id: 'shop-merchant', account_uid: JOINT, amount: -30, credit_debit: 'DBIT', booking_date: '2026-08-09', description: 'Shop Dos Santos', counterparty: 'Shop Dos Santos' }),
    ]);
    setTransactionCategory('shop-alloc', augShop);
    setTransactionCategory('shop-merchant', augShop);

    runAttribution({ jointAccountUids: [JOINT] });

    // €650, NOT €680.
    expect(bankSpentByCategory(2026, 8)[augShop]).toBeCloseTo(650, 2);
    expect(getTransactionById('shop-merchant')!.counted).toBe(0);
    expect(getTransactionById('shop-merchant')!.unallocated).toBe(1);
  });

  it('excludes personal-account rows entirely (not counted, not in the review queue)', () => {
    seedBudgetIfEmpty(); // Gym planned 138
    const augGym = gymIdFor(2026, 8);

    upsertTransactions([
      // The joint leg of a Gym move — this is what counts.
      bookedTx({ id: 'gym-joint', account_uid: JOINT, amount: -138, credit_debit: 'DBIT', booking_date: '2026-08-05', description: 'Gym', counterparty: RAFAELA }),
      // The mirror on the PERSONAL account — the other side of the move. Under
      // the joint-only model this is excluded entirely, so it can't double-count.
      bookedTx({ id: 'gym-personal', account_uid: PERSONAL, amount: 138, credit_debit: 'CRDT', booking_date: '2026-08-05', description: 'Gym', counterparty: RAFAEL }),
    ]);
    setTransactionCategory('gym-joint', augGym);
    setTransactionCategory('gym-personal', augGym);

    runAttribution({ jointAccountUids: [JOINT] });

    // Counted once (€138), from the joint leg only.
    expect(bankSpentByCategory(2026, 8)[augGym]).toBeCloseTo(138, 2);

    const personal = getTransactionById('gym-personal')!;
    expect(personal.counted).toBe(0);
    expect(personal.unallocated).toBe(0); // excluded, NOT a review item
    expect(listUnallocated({ month: '2026-08' }).map((r) => r.id)).not.toContain('gym-personal');
  });

  it('leaves a joint internal transfer that matched no category unallocated for review', () => {
    seedBudgetIfEmpty();
    upsertTransactions([
      bookedTx({ id: 'savings', account_uid: JOINT, amount: -300, credit_debit: 'DBIT', booking_date: '2026-08-06', description: 'Savings', counterparty: RAFAELA }),
    ]);
    // Left uncategorized (matches no budget category name).
    runAttribution({ jointAccountUids: [JOINT] });

    const r = getTransactionById('savings')!;
    expect(r.counted).toBe(0);
    expect(r.unallocated).toBe(1);
    expect(bankSpentByCategory(2026, 8)).toEqual({});
  });

  it('rolls a next-month pre-payment forward, reports the move once, and is idempotent on re-run', () => {
    seedBudgetIfEmpty(); // Aug/2026 — Gym 138
    createNextMonth(); // Sep/2026 carries Gym 138 forward
    const augGym = gymIdFor(2026, 8);
    const sepGym = gymIdFor(2026, 9);

    upsertTransactions([
      bookedTx({ id: 'gym-aug', account_uid: JOINT, amount: -138, credit_debit: 'DBIT', booking_date: '2026-08-10', description: 'Gym', counterparty: RAFAELA }),
      bookedTx({ id: 'gym-early', account_uid: JOINT, amount: -138, credit_debit: 'DBIT', booking_date: '2026-08-20', description: 'Gym', counterparty: RAFAELA }),
    ]);
    for (const id of ['gym-aug', 'gym-early']) setTransactionCategory(id, augGym);

    const first = runAttribution({ jointAccountUids: [JOINT] });
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ id: 'gym-early', category: 'Gym', fromMonth: '2026-08', toMonth: '2026-09' });

    // Each month shows €138 under its OWN Gym id.
    expect(bankSpentByCategory(2026, 8)[augGym]).toBeCloseTo(138, 2);
    expect(bankSpentByCategory(2026, 9)[sepGym]).toBeCloseTo(138, 2);

    const early = getTransactionById('gym-early')!;
    expect(early.budget_month).toBe('2026-09');
    expect(early.category_id).toBe(sepGym); // re-pointed to September's Gym id
    expect(early.move_reason).toMatch(/Ago.*Gym.*Set/);

    // A second run over the identical steady state re-reports nothing.
    const second = runAttribution({ jointAccountUids: [JOINT] });
    expect(second).toHaveLength(0);
    expect(getTransactionById('gym-early')!.budget_month).toBe('2026-09');
  });

  it('clamps a NEGATIVE net (returns exceed outflows) to 0 and flags the category', () => {
    seedBudgetIfEmpty(); // Insurance planned 150
    const augInsurance = catIdFor(2026, 8, 'Insurance');

    upsertTransactions([
      bookedTx({ id: 'ins-out', account_uid: JOINT, amount: -100, credit_debit: 'DBIT', booking_date: '2026-08-05', description: 'Insurance', counterparty: RAFAELA }),
      bookedTx({ id: 'ins-over-return', account_uid: JOINT, amount: 160, credit_debit: 'CRDT', booking_date: '2026-08-06', description: 'Insurance', counterparty: RAFAELA }),
    ]);
    for (const id of ['ins-out', 'ins-over-return']) setTransactionCategory(id, augInsurance);

    runAttribution({ jointAccountUids: [JOINT] });

    // Raw net = 100 − 160 = −60 -> clamped to 0, category flagged.
    expect(bankSpentByCategory(2026, 8)[augInsurance]).toBe(0);
    expect(bankSpentAnomalies(2026, 8)).toContain(augInsurance);
  });

  it('attributes a payday allocation to the month its salary funds, and keeps the salary credit out', () => {
    seedBudgetIfEmpty(); // Aug/2026 — MacBook planned 92.23
    const augMacBook = catIdFor(2026, 8, 'MacBook');

    upsertTransactions([
      // July salary (external employer) lands 07-31 — that distribution funds Aug.
      bookedTx({ id: 'salary-jul', account_uid: JOINT, amount: 2942.31, credit_debit: 'CRDT', booking_date: '2026-07-31', description: 'Salary El To RAFAEL', counterparty: 'ACME Payroll Ltd' }),
      // The MacBook allocation booked the same day.
      bookedTx({ id: 'macbook-jul', account_uid: JOINT, amount: -92.23, credit_debit: 'DBIT', booking_date: '2026-07-31', description: 'MacBook', counterparty: RAFAELA }),
    ]);
    setTransactionCategory('macbook-jul', augMacBook);

    const moves = runAttribution({ jointAccountUids: [JOINT] });

    const mb = getTransactionById('macbook-jul')!;
    expect(mb.budget_month).toBe('2026-08'); // payday distribution -> next month
    expect(mb.counted).toBe(1);
    expect(mb.move_reason).toMatch(/salário/i);
    expect(bankSpentByCategory(2026, 8)[augMacBook]).toBeCloseTo(92.23, 2);

    // The external salary credit never counts.
    const salary = getTransactionById('salary-jul')!;
    expect(salary.counted).toBe(0);
    expect(salary.unallocated).toBe(1);

    expect(moves.some((m) => m.id === 'macbook-jul' && m.fromMonth === '2026-07' && m.toMonth === '2026-08')).toBe(true);
  });

  it('nets a refund against its OWN outflow, not an unrelated same-category one that rolled forward (HIGH-1)', () => {
    seedBudgetIfEmpty(); // Aug/2026 — Gym 138
    createNextMonth(); // Sep/2026 carries Gym 138 forward
    const augGym = gymIdFor(2026, 8);
    const sepGym = gymIdFor(2026, 9);

    // A: never refunded (real spend). B: refunded by C. Same category & month.
    // The OLD per-tx stream let C net against A after B rolled to Sep (giving
    // Aug=0, Sep=138). Summing the (Gym, Aug) bucket FIRST keeps B and its refund
    // C cancelling WITHIN August — so nothing rolls forward.
    upsertTransactions([
      bookedTx({ id: 'gym-a', account_uid: JOINT, amount: -138, credit_debit: 'DBIT', booking_date: '2026-08-05', description: 'Gym', counterparty: RAFAELA }),
      bookedTx({ id: 'gym-b', account_uid: JOINT, amount: -138, credit_debit: 'DBIT', booking_date: '2026-08-10', description: 'Gym', counterparty: RAFAELA }),
      bookedTx({ id: 'gym-c', account_uid: JOINT, amount: 138, credit_debit: 'CRDT', booking_date: '2026-08-15', description: 'Gym', counterparty: RAFAELA }),
    ]);
    for (const id of ['gym-a', 'gym-b', 'gym-c']) setTransactionCategory(id, augGym);

    runAttribution({ jointAccountUids: [JOINT] });

    expect(bankSpentByCategory(2026, 8)[augGym]).toBeCloseTo(138, 2);
    expect(bankSpentByCategory(2026, 9)[sepGym] ?? 0).toBeCloseTo(0, 2);
  });

  it('a spoofed full-name CRDT with no prior counted DBIT is routed to review, not subtracted (HIGH-B)', () => {
    seedBudgetIfEmpty(); // Gym planned 138
    const augGym = gymIdFor(2026, 8);

    // Attacker names themselves with a holder's full name and sends a
    // categorized inbound credit. With no prior Gym DBIT to net against it must
    // NOT reduce Gym — it goes to the unallocated review queue instead.
    upsertTransactions([
      bookedTx({ id: 'spoof-credit', account_uid: JOINT, amount: 80, credit_debit: 'CRDT', booking_date: '2026-08-07', description: 'Gym', counterparty: 'Rafael Petriccone' }),
    ]);
    setTransactionCategory('spoof-credit', augGym);

    runAttribution({ jointAccountUids: [JOINT] });

    const t = getTransactionById('spoof-credit')!;
    expect(t.counted).toBe(0);
    expect(t.unallocated).toBe(1);
    expect(bankSpentByCategory(2026, 8)[augGym]).toBeUndefined();
    expect(listUnallocated({ month: '2026-08' }).map((r) => r.id)).toContain('spoof-credit');
  });

  it('a field-split arrow spoof (counterparty "Joint -> Personal" + a real category label in description) is NOT internal, NOT counted (security MEDIUM)', () => {
    seedBudgetIfEmpty(); // Shop planned
    const augShop = catIdFor(2026, 8, 'Shop');

    // An inbound credit whose counterparty spoofs the self-transfer arrow while
    // its description independently carries a real category name. categorize.ts's
    // matchLabel reads description/counterparty independently, so without the
    // other-field-empty guard the arrow would wrongly mark this internal and let
    // it subtract from Shop.
    expect(isInternalTransfer({ counterparty: 'Joint -> Personal', description: 'Shop' })).toBe(false);

    upsertTransactions([
      bookedTx({ id: 'spoof-split', account_uid: JOINT, amount: 40, credit_debit: 'CRDT', booking_date: '2026-08-07', description: 'Shop', counterparty: 'Joint -> Personal' }),
    ]);
    setTransactionCategory('spoof-split', augShop);

    runAttribution({ jointAccountUids: [JOINT] });

    const t = getTransactionById('spoof-split')!;
    expect(t.counted).toBe(0);
    expect(t.unallocated).toBe(1);
    expect(bankSpentByCategory(2026, 8)[augShop]).toBeUndefined();
    expect(listUnallocated({ month: '2026-08' }).map((r) => r.id)).toContain('spoof-split');
  });

  it('a CRDT that pairs with a prior counted DBIT still nets (insurance 156/156/112.80 → €112.80) (HIGH-B)', () => {
    seedBudgetIfEmpty(); // Insurance planned 150
    const augInsurance = catIdFor(2026, 8, 'Insurance');

    upsertTransactions([
      bookedTx({ id: 'ib-out', account_uid: JOINT, amount: -156, credit_debit: 'DBIT', booking_date: '2026-08-10', description: 'Insurance', counterparty: RAFAELA }),
      bookedTx({ id: 'ib-return', account_uid: JOINT, amount: 156, credit_debit: 'CRDT', booking_date: '2026-08-11', description: 'Car insurance', counterparty: RAFAELA }),
      bookedTx({ id: 'ib-out2', account_uid: JOINT, amount: -112.8, credit_debit: 'DBIT', booking_date: '2026-08-12', description: 'Car insurance', counterparty: RAFAELA }),
    ]);
    for (const id of ['ib-out', 'ib-return', 'ib-out2']) setTransactionCategory(id, augInsurance);

    runAttribution({ jointAccountUids: [JOINT] });

    // The return pairs with the prior 156 DBIT, so it IS counted and nets.
    expect(getTransactionById('ib-return')!.counted).toBe(1);
    expect(bankSpentByCategory(2026, 8)[augInsurance]).toBeCloseTo(112.8, 2);
  });

  it('joint_account_uids UNSET → attributes and sums nothing, never counts personal rows (MED-2)', () => {
    seedBudgetIfEmpty(); // Gym planned 138
    const augGym = gymIdFor(2026, 8);
    setJointAccountUids([]); // override the beforeEach — no joint scope configured

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      upsertTransactions([
        bookedTx({ id: 'nj-joint', account_uid: JOINT, amount: -138, credit_debit: 'DBIT', booking_date: '2026-08-05', description: 'Gym', counterparty: RAFAELA }),
        bookedTx({ id: 'nj-personal', account_uid: PERSONAL, amount: -138, credit_debit: 'DBIT', booking_date: '2026-08-05', description: 'Gym', counterparty: RAFAEL }),
      ]);
      for (const id of ['nj-joint', 'nj-personal']) setTransactionCategory(id, augGym);

      // No jointAccountUids passed -> reads the (unset) setting.
      runAttribution();

      expect(getTransactionById('nj-joint')!.counted).toBe(0);
      expect(getTransactionById('nj-personal')!.counted).toBe(0);
      expect(bankSpentByCategory(2026, 8)).toEqual({});
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

// Counterparty→category rules: an EXTERNAL charge whose counterparty matches an
// explicit rule (e.g. "Clúid Housing Association" → Rental — the rent direct
// debit) counts as spend, with the same joint-only / signed-net / payday
// roll-forward treatment as an internal labeled move. The CRDT guard is
// symmetric: a rule-matched external refund nets against a prior counted
// balance, else goes to review.
describe('runAttribution — counterparty rule-matched external charges (DB-backed)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attribution-rules-test-'));

  const bookedTx = (
    over: Partial<BankTransactionInput> &
      Pick<BankTransactionInput, 'id' | 'account_uid' | 'amount' | 'credit_debit' | 'booking_date' | 'description'>,
  ): BankTransactionInput => ({
    currency: 'EUR',
    value_date: over.booking_date,
    counterparty: null,
    status: 'BOOK',
    ...over,
  });

  beforeAll(() => {
    process.env.PETRICCO_DATA_DIR = tmpDir;
    initBankSchema();
    initBudgetSchema();
  });

  afterAll(() => {
    delete process.env.PETRICCO_DATA_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    const db = getDb();
    db.exec(
      'DELETE FROM bank_transactions;' +
        'DELETE FROM bank_sessions;' +
        'DELETE FROM bank_settings;' +
        'DELETE FROM bank_category_rules;' +
        'DELETE FROM budget_categories;' +
        'DELETE FROM budget_incomes;' +
        'DELETE FROM budget_months;' +
        'DELETE FROM budget_settings;',
    );
    // bank_settings was just wiped — (re)mark the joint account + seed the
    // one explicit rule every test here relies on.
    setJointAccountUids([JOINT]);
    addBankCategoryRule({ pattern: 'Clúid Housing Association', category_name: 'Rental' });
  });

  const rentalIdFor = (year: number, month: number): string => {
    const m = getMonthByYM(year, month);
    const cat = m?.categories.find((c) => c.name === 'Rental');
    if (!cat) throw new Error(`no Rental category for ${year}-${month}`);
    return cat.id;
  };

  it('an external rule-matched charge on the joint account counts as spend', () => {
    seedBudgetIfEmpty(); // Aug/2026 — Rental planned 1397
    const augRental = rentalIdFor(2026, 8);

    upsertTransactions([
      bookedTx({ id: 'rent-aug', account_uid: JOINT, amount: -1397, credit_debit: 'DBIT', booking_date: '2026-08-03', description: 'Monthly rent DD', counterparty: 'Clúid Housing Association' }),
    ]);
    setTransactionCategory('rent-aug', augRental);

    runAttribution({ jointAccountUids: [JOINT] });

    expect(bankSpentByCategory(2026, 8)[augRental]).toBeCloseTo(1397, 2);
    const t = getTransactionById('rent-aug')!;
    expect(t.counted).toBe(1);
    expect(t.unallocated).toBe(0);
    expect(t.budget_month).toBe('2026-08'); // booked well before payday — stays
  });

  it('a 29/jul charge with salary 27/jul is attributed to 2026-08 (payday roll-forward)', () => {
    seedBudgetIfEmpty(); // Aug/2026 — Rental planned 1397
    const augRental = rentalIdFor(2026, 8);

    upsertTransactions([
      // July salary lands 27/jul — that distribution funds August.
      bookedTx({ id: 'salary-jul', account_uid: JOINT, amount: 2942.31, credit_debit: 'CRDT', booking_date: '2026-07-27', description: 'Salary El To RAFAEL', counterparty: 'ACME Payroll Ltd' }),
      // The rent direct debit booked 29/jul — ON/AFTER the payday.
      bookedTx({ id: 'rent-jul', account_uid: JOINT, amount: -1397, credit_debit: 'DBIT', booking_date: '2026-07-29', description: 'Monthly rent DD', counterparty: 'Clúid Housing Association' }),
    ]);
    setTransactionCategory('rent-jul', augRental);

    runAttribution({ jointAccountUids: [JOINT] });

    const t = getTransactionById('rent-jul')!;
    expect(t.counted).toBe(1);
    expect(t.budget_month).toBe('2026-08');
    expect(t.move_reason).toMatch(/salário/i);
    expect(bankSpentByCategory(2026, 8)[augRental]).toBeCloseTo(1397, 2);
    // The salary credit itself never counts (external, no rule).
    expect(getTransactionById('salary-jul')!.counted).toBe(0);
  });

  it('a rule-matched charge whose salary-adjusted month has NO plan stays in the booking month + review flag', () => {
    seedBudgetIfEmpty(); // only Aug/2026 exists — no 2026-06 month
    const augRental = rentalIdFor(2026, 8);

    upsertTransactions([
      bookedTx({ id: 'salary-may', account_uid: JOINT, amount: 2942.31, credit_debit: 'CRDT', booking_date: '2026-05-27', description: 'Salary El', counterparty: 'ACME Payroll Ltd' }),
      // 29/may >= May's payday (27) -> salary-adjusted base month 2026-06,
      // which has no Rental plan -> stays in 2026-05, flagged for review.
      bookedTx({ id: 'rent-may', account_uid: JOINT, amount: -1397, credit_debit: 'DBIT', booking_date: '2026-05-29', description: 'Monthly rent DD', counterparty: 'Clúid Housing Association' }),
    ]);
    setTransactionCategory('rent-may', augRental);

    runAttribution({ jointAccountUids: [JOINT] });

    const t = getTransactionById('rent-may')!;
    expect(t.counted).toBe(1); // still counted spend — just not moved
    expect(t.budget_month).toBe('2026-05');
    expect(t.move_reason).toMatch(/Sem planejado/i);
  });

  it('a rule-matched external REFUND nets against a prior counted balance (CRDT symmetric)', () => {
    seedBudgetIfEmpty();
    const augRental = rentalIdFor(2026, 8);

    upsertTransactions([
      bookedTx({ id: 'rent-out', account_uid: JOINT, amount: -1397, credit_debit: 'DBIT', booking_date: '2026-08-03', description: 'Monthly rent DD', counterparty: 'Clúid Housing Association' }),
      bookedTx({ id: 'rent-partial-back', account_uid: JOINT, amount: 200, credit_debit: 'CRDT', booking_date: '2026-08-10', description: 'Rent adjustment', counterparty: 'Clúid Housing Association' }),
    ]);
    for (const id of ['rent-out', 'rent-partial-back']) setTransactionCategory(id, augRental);

    runAttribution({ jointAccountUids: [JOINT] });

    expect(getTransactionById('rent-out')!.counted).toBe(1);
    expect(getTransactionById('rent-partial-back')!.counted).toBe(1); // nets vs prior balance
    expect(bankSpentByCategory(2026, 8)[augRental]).toBeCloseTo(1197, 2);
  });

  it('a rule-matched external REFUND with NO prior counted balance goes to review, never subtracts', () => {
    seedBudgetIfEmpty();
    const augRental = rentalIdFor(2026, 8);

    upsertTransactions([
      bookedTx({ id: 'rent-cold-crdt', account_uid: JOINT, amount: 200, credit_debit: 'CRDT', booking_date: '2026-08-10', description: 'Rent adjustment', counterparty: 'Clúid Housing Association' }),
    ]);
    setTransactionCategory('rent-cold-crdt', augRental);

    runAttribution({ jointAccountUids: [JOINT] });

    const t = getTransactionById('rent-cold-crdt')!;
    expect(t.counted).toBe(0);
    expect(t.unallocated).toBe(1);
    expect(bankSpentByCategory(2026, 8)[augRental]).toBeUndefined();
    expect(listUnallocated({ month: '2026-08' }).map((r) => r.id)).toContain('rent-cold-crdt');
  });

  it('a NON-rule external (Tesco) is still NOT counted even when manually categorized — rules change nothing', () => {
    seedBudgetIfEmpty();
    const augShop = getMonthByYM(2026, 8)!.categories.find((c) => c.name === 'Shop')!.id;

    upsertTransactions([
      bookedTx({ id: 'tesco-with-rules', account_uid: JOINT, amount: -14.35, credit_debit: 'DBIT', booking_date: '2026-08-12', description: 'Tesco Stores 6913', counterparty: 'Tesco Stores' }),
    ]);
    setTransactionCategory('tesco-with-rules', augShop);

    runAttribution({ jointAccountUids: [JOINT] });

    const t = getTransactionById('tesco-with-rules')!;
    expect(t.counted).toBe(0);
    expect(t.unallocated).toBe(1);
    expect(bankSpentByCategory(2026, 8)[augShop]).toBeUndefined();
  });
});
