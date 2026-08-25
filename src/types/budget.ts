// Domain types for the couple's monthly budget model (planned/spent that
// zeros out, grouped Fixos/Variáveis/Extras, two salaries → surplus → 50/50).
// See docs/2026-08-15-budget-model-redesign-design.md.

export type BudgetGroup = 'fixed' | 'variable' | 'extra';
export type IncomeKind = 'salary' | 'extra';

export interface BudgetCategory {
  id: string;
  monthId: string;
  group: BudgetGroup;
  name: string;
  planned: number;
  spent: number;
  spentAdjustment?: number;
  sortOrder: number;
}

export interface BudgetIncome {
  id: string;
  monthId: string;
  label: string;
  amount: number;
  kind: IncomeKind;
  sortOrder: number;
}

export interface BudgetMonthRollups {
  totalPlanned: number;
  totalSpent: number;
  salaryTotal: number;      // sum of incomes where kind==='salary'
  extraIncomeTotal: number; // sum of incomes where kind==='extra'
  netWorth: number;         // salaryTotal - totalPlanned
  save: number;
  us: number;               // netWorth - save
  el: number;               // us / 2
  ela: number;              // us / 2
  totalSaving: number;      // savingsOpeningBalance + cumulative save of all months up to & incl this one
}

export interface BudgetMonth {
  id: string;
  year: number;
  month: number;
  save: number;
  // "Saldo em Conta": the sheet's carry row ("Last Month" category, typed at
  // close) + (planejado − gasto exibido), where gasto exibido = manual +
  // bank-attributed + adjustment and the carry row is excluded from both
  // totals. Composed bank-aware by the API layer (account-balance.ts
  // withAccountBalance) — budget-store's own value covers manual + adj only.
  accountBalance: number;
  note?: string;
  categories: BudgetCategory[];
  incomes: BudgetIncome[];
  rollups: BudgetMonthRollups;
}

export interface BudgetMonthSummary {
  id: string;
  year: number;
  month: number;
}

export interface BudgetSettings {
  savingsOpeningBalance: number;
  personALabel: string;
  personBLabel: string;
  currency: string;
}
