// Saldo em Conta composition. The sheet's formula is
//   "Last Month" carry row + (planejado − gasto)
// where "gasto" is the DISPLAYED spend: manual + bank-attributed + adjustment,
// and the carry row itself ("Last Month", typed by the couple at close, exactly
// like the sheet) is excluded from the bills totals. budget-store cannot see
// bank spend (module cycle: bank-store imports budget-store for getMonthByYM),
// so the API layer composes the final number here and overwrites
// BudgetMonth.accountBalance on every budget month response. budget-store's
// own value (manual + adjustment only) is a fallback for direct store
// consumers and is ALWAYS superseded by withAccountBalance before a month
// reaches a client.

import { bankSpentByCategory } from './bank-store';
import { computeSaldoEmConta } from './groupSpent';
import type { BudgetMonth } from '@/types/budget';

export function monthAccountBalance(month: BudgetMonth): number {
  const bank = bankSpentByCategory(month.year, month.month);
  return computeSaldoEmConta(month.categories, bank);
}

// Attach the bank-aware Saldo em Conta to a hydrated month (pure overlay —
// returns a new object; bankSpentByCategory is read-only over the DB).
export function withAccountBalance(month: BudgetMonth): BudgetMonth {
  return { ...month, accountBalance: monthAccountBalance(month) };
}
