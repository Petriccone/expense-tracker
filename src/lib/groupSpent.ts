// Pure money math for CategoryGroupCard's displayed spending totals. Kept as
// standalone functions (not inline in the .tsx) so they're unit-testable
// without a React/DOM harness, following this repo's convention of testing
// pure money math directly (see budget-store.ts's computeRollups).

import type { BudgetCategory } from '@/types/budget';

type CategoryWithSpentAdjustment = Pick<BudgetCategory, 'spent'> & {
  // Optional keeps old fixtures and callers compatible while the additive
  // field is introduced across the budget data path.
  spentAdjustment?: number;
};

export function categorySpentAdjustment(category: { spentAdjustment?: number }): number {
  return category.spentAdjustment ?? 0;
}

export function categorySpentTotal(
  category: CategoryWithSpentAdjustment,
  bankSpent: number,
): number {
  return category.spent + bankSpent + categorySpentAdjustment(category);
}

export function spentAdjustmentForTotal(
  desiredTotal: number,
  manualSpent: number,
  bankSpent: number,
): number {
  return desiredTotal - manualSpent - bankSpent;
}

export function groupSpentSum(
  categories: (Pick<BudgetCategory, 'id' | 'spent'> & { spentAdjustment?: number })[],
  bankSpent: Record<string, number>,
): number {
  return categories.reduce((sum, c) => sum + categorySpentTotal(c, bankSpent[c.id] ?? 0), 0);
}

// "Saldo em Conta" (sheet): the couple's carry row + the planned budget not
// yet spent. In the sheet (and this app's data, mirrored by
// repair-budget-from-sheet) the carry is a category row literally named
// "Last Month" that sits OUTSIDE the Bills totals: its (effective) spent is
// the opening saldo, its planned (usually 0, but not always — Mai carried
// 166.12) must leave the planned total too. Verified against the sheet:
//   Ago: 71.16 + (4.074,71 − 3.794,04) = 351.83.
// Consumes the EFFECTIVE spent (manual + bank + adjustment) — manual-only
// would ignore bank-attributed spend and overstate the balance.
export const BALANCE_CARRY_CATEGORY = 'last month';

function isBalanceCarryRow(c: { name: string }): boolean {
  return c.name.trim().toLowerCase() === BALANCE_CARRY_CATEGORY;
}

export function computeSaldoEmConta(
  categories: (Pick<BudgetCategory, 'id' | 'name' | 'planned' | 'spent'> & {
    spentAdjustment?: number;
  })[],
  bankSpent: Record<string, number>,
): number {
  let carry = 0;
  let planned = 0;
  let spent = 0;
  for (const c of categories) {
    if (isBalanceCarryRow(c)) {
      carry += categorySpentTotal(c, bankSpent[c.id] ?? 0);
      // The carry row's planned is bookkeeping (Mai had 166.12), not a bill.
      continue;
    }
    planned += c.planned;
    spent += categorySpentTotal(c, bankSpent[c.id] ?? 0);
  }
  return round2(carry + planned - spent);
}

// Round to cents, half away from zero — same as round2 in budget-store.ts.
function round2(n: number): number {
  return (Math.sign(n) * Math.round(Math.abs(n) * 100 + Number.EPSILON)) / 100;
}
