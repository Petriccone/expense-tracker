// Unit tests for groupSpentSum (pure) — the CategoryGroupCard header total.
// Regression test for the wave-2b bug where the header ignored bankSpent
// while each row showed spent + bankSpent, so the two disagreed. See
// docs/2026-08-15-agent-and-bank-automation-design.md.

import { describe, it, expect } from 'vitest';
import {
  categorySpentTotal,
  computeSaldoEmConta,
  groupSpentSum,
  spentAdjustmentForTotal,
} from './groupSpent';

describe('groupSpentSum', () => {
  it('sums manual spent only when bankSpent is empty', () => {
    const total = groupSpentSum(
      [
        { id: 'cat-1', spent: 100 },
        { id: 'cat-2', spent: 50 },
      ],
      {},
    );
    expect(total).toBeCloseTo(150, 2);
  });

  it('adds bankSpent per category on top of manual spent, matching each row\'s own gasto', () => {
    const total = groupSpentSum(
      [
        { id: 'cat-1', spent: 100 },
        { id: 'cat-2', spent: 50 },
      ],
      { 'cat-1': 20, 'cat-2': 5 },
    );
    // Row 1 gasto = 100 + 20 = 120; row 2 gasto = 50 + 5 = 55; header must
    // match their sum (120 + 55), not just the manual 150.
    expect(total).toBeCloseTo(175, 2);
  });

  it('includes signed per-category adjustments in the group total', () => {
    const total = groupSpentSum(
      [{ id: 'cat-1', spent: 100, spentAdjustment: -25 }],
      { 'cat-1': 20 },
    );
    expect(total).toBeCloseTo(95, 2);
  });

  it('ignores a bankSpent entry for a category id not in the group (defensive)', () => {
    const total = groupSpentSum([{ id: 'cat-1', spent: 10 }], { 'cat-unrelated': 999 });
    expect(total).toBeCloseTo(10, 2);
  });

  it('returns 0 for an empty category list', () => {
    expect(groupSpentSum([], { 'cat-1': 5 })).toBe(0);
  });
});

describe('categorySpentTotal', () => {
  it('defaults a missing adjustment to zero', () => {
    expect(categorySpentTotal({ spent: 40 }, 12)).toBe(52);
  });

  it('supports signed adjustments without changing bank spend', () => {
    expect(categorySpentTotal({ spent: 40, spentAdjustment: -12.5 }, 30)).toBe(57.5);
  });
});

describe('spentAdjustmentForTotal', () => {
  it('calculates the correction needed for a desired displayed total', () => {
    expect(spentAdjustmentForTotal(0, 0, 123.96)).toBeCloseTo(-123.96, 2);
  });
});

describe('computeSaldoEmConta (real sheet numbers)', () => {
  it('Aug/2026 — "Last Month" carry row + (planned − gasto exibido) = the sheet\'s €351,83', () => {
    // Prod Aug, mirrored from the sheet: the "Last Month" row carries the
    // opening saldo (71.16) as its spent, planned 0; real bills sum planned
    // 4.074,71. The Gasto column's 3.794,04 is the DISPLAYED spend composed
    // manual 386,13 (of which 71,16 is the carry row) + bank 3.479,07.
    // The carry row is excluded from BOTH totals, then added as the opening.
    const cats = [
      { id: 'bills', name: 'Shop', planned: 4074.71, spent: 314.97 }, // manual bills share
      { id: 'lm', name: 'Last Month', planned: 0, spent: 71.16 }, // the carry row
    ];
    const bank = { bills: 3479.07 };
    // gasto exibido total = 314,97 + 3.479,07 + 71,16 = 3.865,20 (snapshot check),
    // de composto sem o carry = 3.794,04 → saldo = 71,16 + 280,67 = 351,83.
    expect(groupSpentSum(cats, bank)).toBeCloseTo(3865.2, 2);
    expect(computeSaldoEmConta(cats, bank)).toBe(351.83);
  });

  it('the carry row\'s own planned leaves the planned total too (Mai had 166.12)', () => {
    // Snapshot Mai: planned incl. carry row 5.141,63 − 166,12 = 4.975,51;
    // spent incl. carry 5.204,20 − 95,47 = 5.108,73 → saldo −37,75 (overspent).
    const cats = [
      { id: 'bills', name: 'Bills', planned: 4975.51, spent: 5108.73 },
      { id: 'lm', name: 'last month', planned: 166.12, spent: 95.47 }, // case-insensitive
    ];
    expect(computeSaldoEmConta(cats, {})).toBeCloseTo(-37.75, 2);
  });

  it('a month WITHOUT a carry row has opening 0 (Jul)', () => {
    // Snapshot Jul: no "Last Month" row → saldo = planned − spent.
    const cats = [{ id: 'bills', name: 'Bills', planned: 5180.07, spent: 4295.83 }];
    expect(computeSaldoEmConta(cats, {})).toBeCloseTo(884.24, 2);
  });

  it('bank spend on the carry row counts toward the opening (defensive)', () => {
    const cats = [{ id: 'lm', name: 'Last Month', planned: 0, spent: 50 }];
    expect(computeSaldoEmConta(cats, { lm: 21.16 })).toBeCloseTo(71.16, 2);
  });

  it('other planned-0 rows are NOT the carry (Toll, Car Wash are real bills)', () => {
    const cats = [
      { id: 'toll', name: 'Toll', planned: 0, spent: 5 },
      { id: 'lm', name: 'Last Month', planned: 0, spent: 71.16 },
    ];
    // Toll stays in gasto; only the carry row leaves it.
    expect(computeSaldoEmConta(cats, {})).toBeCloseTo(71.16 - 5, 2);
  });

  it('is exact to the cent with float-dirty inputs (round2 half away from zero)', () => {
    const cats = [
      { id: 'a', name: 'A', planned: 100.005, spent: 50.005 },
      { id: 'lm', name: 'Last Month', planned: 0, spent: 0.1 + 0.2 },
    ];
    expect(computeSaldoEmConta(cats, {})).toBeCloseTo(50.3, 2);
  });
});
