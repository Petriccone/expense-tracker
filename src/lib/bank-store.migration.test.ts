// Regression test for the wave-2c schema migration (MUST FIX 1): a DB created
// with the OLD (pre-wave-2c) bank_transactions schema must be migrated
// in-place by initBankSchema — the ALTER-if-missing guards add
// budget_month / counted / dedup_group / move_reason and backfill
// budget_month from booking_date. Without this the banking routes throw
// `no such column: budget_month` after deploy against a pre-existing DB.
//
// Kept as its OWN test file so it owns a fresh module/DB state: it hand-builds
// the old-schema table on the getDb() connection BEFORE the first
// initBankSchema() call in this process (vitest isolates module state per
// file, so getDb()'s memoized connection and initBankSchema's _schemaReady
// flag both start clean here).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDb } from './db';
import { initBankSchema, getTransactionById } from './bank-store';

describe('initBankSchema migrates a pre-wave-2c DB in place (MUST FIX 1)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bank-migration-test-'));

  beforeAll(() => {
    process.env.PETRICCO_DATA_DIR = tmpDir;
  });

  afterAll(() => {
    delete process.env.PETRICCO_DATA_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const colNames = (): string[] =>
    (getDb().prepare('PRAGMA table_info(bank_transactions)').all() as Array<{ name: string }>).map((c) => c.name);

  it('adds the wave-2c columns to an existing old-schema table and backfills budget_month', () => {
    const db = getDb();

    // Old (wave-2b) schema: has `ignored`, but none of the wave-2c columns.
    db.exec(`
      CREATE TABLE bank_transactions (
        id           TEXT PRIMARY KEY,
        account_uid  TEXT NOT NULL,
        amount       REAL NOT NULL,
        currency     TEXT,
        credit_debit TEXT,
        booking_date TEXT,
        value_date   TEXT,
        description  TEXT NOT NULL,
        counterparty TEXT,
        status       TEXT,
        category_id  TEXT,
        confidence   REAL,
        ignored      INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT NOT NULL
      );
    `);
    db.prepare(
      `INSERT INTO bank_transactions
         (id, account_uid, amount, currency, credit_debit, booking_date, value_date,
          description, counterparty, status, category_id, confidence, ignored, created_at)
       VALUES ('old-1', 'acc-1', -42.5, 'EUR', 'DBIT', '2026-07-09', '2026-07-09',
               'Legacy row', NULL, 'BOOK', NULL, NULL, 0, '2026-07-09T00:00:00Z')`,
    ).run();

    // Before migration the wave-2c/2d columns are absent.
    const before = colNames();
    for (const col of ['budget_month', 'counted', 'dedup_group', 'move_reason', 'unallocated']) {
      expect(before).not.toContain(col);
    }

    initBankSchema();

    // After migration all five exist.
    const after = colNames();
    for (const col of ['budget_month', 'counted', 'dedup_group', 'move_reason', 'unallocated']) {
      expect(after).toContain(col);
    }

    // The pre-existing row was migrated: budget_month backfilled from
    // booking_date, counted/unallocated picked up their column defaults.
    const row = getTransactionById('old-1')!;
    expect(row.budget_month).toBe('2026-07'); // backfilled from booking_date
    expect(row.counted).toBe(1); // ADD COLUMN ... DEFAULT 1
    expect(row.dedup_group).toBeNull();
    expect(row.move_reason).toBeNull();
    expect(row.unallocated).toBe(0); // ADD COLUMN ... DEFAULT 0

    // Idempotent: a second run is a clean no-op (no throw, columns unchanged).
    expect(() => initBankSchema()).not.toThrow();
    expect(colNames()).toEqual(after);
  });
});
