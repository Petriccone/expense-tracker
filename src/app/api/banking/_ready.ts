// Ensures the bank schema — including the wave-2c intelligence-layer columns
// (budget_month / counted / dedup_group / move_reason) and their
// ALTER-if-missing migration + budget_month backfill — exists before any
// banking route touches the store. Guarded module-level so it only runs once
// per server process; initBankSchema is itself idempotent, so every call after
// the first is a cheap no-op. Mirrors budget/_ready.ts.
//
// Without this, a route whose first store call references a wave-2c column on
// a DB created before that column existed throws `no such column:
// budget_month` — the CREATE TABLE IF NOT EXISTS in initBankSchema only helps
// a brand-new DB, so the ALTER-guarded migration must actually run first.

import { initBankSchema } from '@/lib/bank-store';

let ready = false;

export function ensureBankReady(): void {
  if (ready) return;
  initBankSchema();
  ready = true;
}
