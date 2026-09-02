// Unit tests for the PURE money math (`computeRollups`). Asserted against the
// couple's real spreadsheet numbers (Dec/Jan/Jun), verified in the design doc.
// Money compared with toBeCloseTo(_, 2) to avoid binary-float flakiness.
//
// These hit the pure function only — no DB, no file I/O.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  computeRollups,
  initBudgetSchema,
  seedBudgetIfEmpty,
  createNextMonth,
  createMonthFromTemplate,
  getCurrentMonth,
  getMonthByYM,
  listMonths,
  updateMonth,
  updateCategory,
} from './budget-store';
import { getDb } from './db';

describe('computeRollups (real sheet numbers)', () => {
  it('December — netWorth = salaries - planned; us; 50/50 split', () => {
    const r = computeRollups({
      categories: [{ planned: 4395.07, spent: 1234.56 }],
      incomes: [
        { amount: 2579.91, kind: 'salary' },
        { amount: 3185.0, kind: 'salary' },
      ],
      save: 0,
      savingsOpeningBalance: 0,
      cumulativeSaveThroughThisMonth: 0,
    });

    expect(r.salaryTotal).toBeCloseTo(5764.91, 2);
    expect(r.totalPlanned).toBeCloseTo(4395.07, 2);
    expect(r.netWorth).toBeCloseTo(1369.84, 2);
    expect(r.us).toBeCloseTo(1369.84, 2);
    expect(r.el).toBeCloseTo(684.92, 2);
    expect(r.ela).toBeCloseTo(684.92, 2);
  });

  it('January — save reduces us; 50/50 split', () => {
    const r = computeRollups({
      categories: [{ planned: 4756.33, spent: 0 }],
      incomes: [
        { amount: 2755.19, kind: 'salary' },
        { amount: 3300.0, kind: 'salary' },
      ],
      save: 300,
      savingsOpeningBalance: 0,
      cumulativeSaveThroughThisMonth: 300,
    });

    expect(r.salaryTotal).toBeCloseTo(6055.19, 2);
    expect(r.netWorth).toBeCloseTo(1298.86, 2);
    expect(r.us).toBeCloseTo(998.86, 2);
    expect(r.el).toBeCloseTo(499.43, 2);
    expect(r.ela).toBeCloseTo(499.43, 2);
  });

  it('June — total saving = opening balance + cumulative save', () => {
    const r = computeRollups({
      categories: [],
      incomes: [],
      save: 700,
      savingsOpeningBalance: 3372.79,
      cumulativeSaveThroughThisMonth: 700,
    });

    expect(r.totalSaving).toBeCloseTo(4072.79, 2);
  });

  it('extra income is tracked but excluded from the Net Worth base', () => {
    const r = computeRollups({
      categories: [{ planned: 4395.07, spent: 0 }],
      incomes: [
        { amount: 2579.91, kind: 'salary' },
        { amount: 3185.0, kind: 'salary' },
        { amount: 320, kind: 'extra' },
      ],
      save: 0,
      savingsOpeningBalance: 0,
      cumulativeSaveThroughThisMonth: 0,
    });

    expect(r.netWorth).toBeCloseTo(1369.84, 2);
    expect(r.extraIncomeTotal).toBeCloseTo(320, 2);
    expect(r.salaryTotal).toBeCloseTo(5764.91, 2);
  });

  it('odd-cent us splits so el + ela reconstruct exactly (real seed numbers)', () => {
    // Seed Aug/2026: salaries 2942.31 + 2855.83 = 5798.14, planned 4074.71,
    // save 700 -> us = (5798.14 - 4074.71) - 700 = 1023.43 (odd cent).
    // round2(half) + round2(half) would drift off by a cent — locks the fix:
    // el is rounded, ela is derived as the exact remainder of round2(us), so
    // el + ela === us always (which cent lands where depends on float
    // rounding of the raw sum, not a hand-picked decimal rule).
    const r = computeRollups({
      categories: [{ planned: 4074.71, spent: 0 }],
      incomes: [
        { amount: 2942.31, kind: 'salary' },
        { amount: 2855.83, kind: 'salary' },
      ],
      save: 700,
      savingsOpeningBalance: 0,
      cumulativeSaveThroughThisMonth: 0,
    });

    expect(r.us).toBeCloseTo(1023.43, 2);
    expect(r.el).toBe(511.71);
    expect(r.ela).toBeCloseTo(511.72, 2);
    expect(r.el + r.ela).toBeCloseTo(r.us, 9);
  });

  it('August — planned/spent totals parse the sheet numbers exactly (Saldo em Conta inputs)', () => {
    // Straight from the sheet's Aug/2026 tab: Saldo Extra (Last Month)
    // €71,16, planned €4.074,71, spent €3.794,04 → Saldo em Conta €351,83.
    const r = computeRollups({
      categories: [{ planned: 4074.71, spent: 3794.04 }],
      incomes: [
        { amount: 2942.31, kind: 'salary' },
        { amount: 2855.83, kind: 'salary' },
      ],
      save: 700,
      savingsOpeningBalance: 4057.17,
      cumulativeSaveThroughThisMonth: 700,
    });

    expect(r.totalPlanned).toBeCloseTo(4074.71, 2);
    expect(r.totalSpent).toBeCloseTo(3794.04, 2);
  });
});

// DB-backed carry-forward tests. `getDb()` (src/lib/db.ts) memoizes its
// connection at module scope on first use, so it can only ever be pointed
// at one data dir per test process — set PETRICCO_DATA_DIR before the very
// first DB touch below (nothing above this point hits the DB: computeRollups
// is pure) and isolate it in a temp dir, cleaned up after.
describe('createNextMonth (DB-backed, real SQLite)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-store-test-'));

  beforeAll(() => {
    process.env.PETRICCO_DATA_DIR = tmpDir;
    initBudgetSchema();
    seedBudgetIfEmpty(); // Aug/2026
  });

  it('stores a signed, rounded spent adjustment without changing manual spent', () => {
    const month = getCurrentMonth();
    expect(month).not.toBeNull();
    const category = month!.categories[0];

    const updated = updateCategory(category.id, { spentAdjustment: -12.345 });
    expect(updated.spent).toBe(category.spent);
    expect(updated.spentAdjustment).toBe(-12.35);

    const reset = updateCategory(category.id, { spentAdjustment: 0 });
    expect(reset.spentAdjustment).toBe(0);
    expect(() => updateCategory(category.id, { spentAdjustment: Number.NaN })).toThrow(
      /spentAdjustment must be a finite number/,
    );
  });

  afterAll(() => {
    delete process.env.PETRICCO_DATA_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('carries forward categories + incomes with spent and save reset to 0', () => {
    const aug = getCurrentMonth();
    expect(aug).not.toBeNull();
    expect(aug!.year).toBe(2026);
    expect(aug!.month).toBe(8);
    expect(aug!.categories.length).toBeGreaterThan(0);
    expect(aug!.incomes.length).toBeGreaterThan(0);

    // Seeded from the sheet incl. the "Last Month" carry row (planned 0,
    // spent 0 in the seed). Store-level Saldo em Conta with nothing spent:
    // planned total (no bank in tests; the API layer composes bank-aware).
    expect(aug!.categories.some((c) => c.name === 'Last Month')).toBe(true);
    expect(aug!.accountBalance).toBeCloseTo(aug!.rollups.totalPlanned, 2);

    const sep = createNextMonth();
    expect(sep.year).toBe(2026);
    expect(sep.month).toBe(9);
    expect(sep.save).toBe(0);
    // The carry row copies like any category, spent reset to 0 — the couple
    // types the closing saldo into it at close, exactly like the sheet.
    const sepCarry = sep.categories.find((c) => c.name === 'Last Month');
    expect(sepCarry).toBeDefined();
    expect(sepCarry!.spent).toBe(0);
    expect(sep.categories).toHaveLength(aug!.categories.length);
    expect(sep.incomes).toHaveLength(aug!.incomes.length);
    expect(sep.categories.every((c) => c.spent === 0)).toBe(true);
    expect(sep.categories.every((c) => c.spentAdjustment === 0)).toBe(true);

    const augPlannedByName = new Map(aug!.categories.map((c) => [c.name, c.planned]));
    for (const c of sep.categories) {
      expect(c.planned).toBeCloseTo(augPlannedByName.get(c.name)!, 2);
    }
    const augAmountByLabel = new Map(aug!.incomes.map((i) => [i.label, i.amount]));
    for (const inc of sep.incomes) {
      expect(inc.amount).toBeCloseTo(augAmountByLabel.get(inc.label)!, 2);
    }
  });

  it('rolls the year over Dec -> Jan', () => {
    createNextMonth(); // Oct/2026
    createNextMonth(); // Nov/2026
    const dec = createNextMonth();
    expect(dec.year).toBe(2026);
    expect(dec.month).toBe(12);

    const jan = createNextMonth();
    expect(jan.year).toBe(2027);
    expect(jan.month).toBe(1);
  });

  it('getMonthByYM finds the exact (year, month) and returns null for one that does not exist', () => {
    const aug = getMonthByYM(2026, 8);
    expect(aug).not.toBeNull();
    expect(aug!.year).toBe(2026);
    expect(aug!.month).toBe(8);
    expect(aug!.categories.length).toBeGreaterThan(0);

    expect(getMonthByYM(2099, 1)).toBeNull();
  });

  it('createMonthFromTemplate backfills an EARLIER month from a template (carries save, fresh UUIDs, spent 0)', () => {
    // The backfill path the one-off script uses: seed a month BEFORE the
    // earliest from the Aug template. createNextMonth can only go forward.
    const aug = getMonthByYM(2026, 8);
    expect(aug).not.toBeNull();

    const may = createMonthFromTemplate(aug!.id, 2026, 5);
    expect(may.year).toBe(2026);
    expect(may.month).toBe(5);
    // save is carried from the template (not reset to 0 like carry-forward).
    expect(may.save).toBeCloseTo(aug!.save, 2);
    // The "Last Month" carry row copies like any category, spent reset to 0 —
    // the couple types the closing saldo into it, like the sheet.
    const mayCarry = may.categories.find((c) => c.name === 'Last Month');
    expect(mayCarry).toBeDefined();
    expect(mayCarry!.spent).toBe(0);
    expect(may.categories).toHaveLength(aug!.categories.length);
    expect(may.incomes).toHaveLength(aug!.incomes.length);
    expect(may.categories.every((c) => c.spent === 0)).toBe(true);

    // Per-month category ids: the backfilled month gets its OWN UUIDs.
    const augIds = new Set(aug!.categories.map((c) => c.id));
    expect(may.categories.every((c) => !augIds.has(c.id))).toBe(true);

    const augPlannedByName = new Map(aug!.categories.map((c) => [c.name, c.planned]));
    for (const c of may.categories) {
      expect(c.planned).toBeCloseTo(augPlannedByName.get(c.name)!, 2);
    }
    const augAmountByLabel = new Map(aug!.incomes.map((i) => [i.label, i.amount]));
    for (const inc of may.incomes) {
      expect(inc.amount).toBeCloseTo(augAmountByLabel.get(inc.label)!, 2);
    }

    // Idempotency guard: a second create for the same (year, month) throws, so
    // the backfill script can catch it and skip an already-seeded month.
    expect(() => createMonthFromTemplate(aug!.id, 2026, 5)).toThrow(/already exists/);
  });

  it('typing the "Last Month" carry row moves the Saldo em Conta (round-trip)', () => {
    // The store-level value is manual-only (API composes bank-aware). Typing
    // the carry row's spent — exactly what the couple does in the sheet —
    // must raise the balance by that amount.
    const may = getMonthByYM(2026, 5)!;
    const before = may.accountBalance;

    const carry = may.categories.find((c) => c.name === 'Last Month')!;
    updateCategory(carry.id, { spent: 71.16 });

    const after = getMonthByYM(2026, 5)!;
    expect(after.accountBalance).toBeCloseTo(before + 71.16, 2);
    expect(after.rollups.totalSpent).toBeCloseTo(may.rollups.totalSpent + 71.16, 2);
  });

  it('refuses a duplicate target month', () => {
    // createNextMonth() always targets MAX(year, month) + 1, which by
    // construction can never already be a row in the table — so its own
    // "already exists" pre-check (a friendlier error than the raw driver
    // error) can only fire on a genuine concurrent race between two writers,
    // not via sequential same-process calls. Verify the invariant it relies
    // on directly: the schema's UNIQUE(year, month) rejects a duplicate.
    const [latest] = listMonths().slice(-1);
    const db = getDb();
    expect(() =>
      db
        .prepare(
          'INSERT INTO budget_months (id, year, month, save, note, created_at) VALUES (?, ?, ?, 0, NULL, ?)',
        )
        .run(crypto.randomUUID(), latest.year, latest.month, new Date().toISOString()),
    ).toThrow();
  });
});
