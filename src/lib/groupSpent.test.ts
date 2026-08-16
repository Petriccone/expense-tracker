// Unit tests for groupSpentSum (pure) — the CategoryGroupCard header total.
// Regression test for the wave-2b bug where the header ignored bankSpent
// while each row showed spent + bankSpent, so the two disagreed. See
// docs/2026-08-15-agent-and-bank-automation-design.md.

import { describe, it, expect } from 'vitest';
import { groupSpentSum } from './groupSpent';

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

  it('ignores a bankSpent entry for a category id not in the group (defensive)', () => {
    const total = groupSpentSum([{ id: 'cat-1', spent: 10 }], { 'cat-unrelated': 999 });
    expect(total).toBeCloseTo(10, 2);
  });

  it('returns 0 for an empty category list', () => {
    expect(groupSpentSum([], { 'cat-1': 5 })).toBe(0);
  });
});
