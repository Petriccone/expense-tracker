// Pure money math for CategoryGroupCard's header total ("€gasto /
// €planejado" on each Fixos/Variáveis/Extras card) — mirrors each row's own
// gasto = category.spent + bankSpent[category.id] (see CategoryRow in
// CategoryGroupCard.tsx). Kept as a standalone pure function (not inline in
// the .tsx) so it's unit-testable without a React/DOM harness, following
// this repo's convention of testing pure money math directly (see
// budget-store.ts's computeRollups). See
// docs/2026-08-15-agent-and-bank-automation-design.md (wave 2b).

import type { BudgetCategory } from '@/types/budget';

export function groupSpentSum(
  categories: Pick<BudgetCategory, 'id' | 'spent'>[],
  bankSpent: Record<string, number>,
): number {
  return categories.reduce((sum, c) => sum + c.spent + (bankSpent[c.id] ?? 0), 0);
}
