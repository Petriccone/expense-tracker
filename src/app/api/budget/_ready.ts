// Ensures the budget schema exists and Aug/2026 is seeded before any budget
// route touches the store. Guarded module-level so it only runs once per
// server process — cheap no-ops (initBudgetSchema/seedBudgetIfEmpty are
// themselves idempotent) on every call after the first.
// See docs/2026-08-15-budget-model-redesign-design.md ("Seed" section).

import { initBudgetSchema, seedBudgetIfEmpty } from '@/lib/budget-store';

let ready = false;

export function ensureBudgetReady(): void {
  if (ready) return;
  initBudgetSchema();
  seedBudgetIfEmpty();
  ready = true;
}
