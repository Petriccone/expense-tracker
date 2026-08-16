// Route-level tests for PATCH /api/banking/transactions/[id] — the wave 2b
// fix: category ids are per-month UUIDs, so a categoryId from a DIFFERENT
// month than the transaction's own booking month must be rejected (400),
// while one from the transaction's own month is accepted. DB-backed: real
// budget-store months/categories + bank-store transactions against the same
// isolated SQLite file (same pattern as bank-store.test.ts /
// categorize.test.ts). See
// docs/2026-08-15-agent-and-bank-automation-design.md (wave 2b fix).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { PATCH } from './route';
import { initBudgetSchema, seedBudgetIfEmpty, createNextMonth, getMonthByYM } from '@/lib/budget-store';
import { initBankSchema, upsertTransactions, getTransactionById } from '@/lib/bank-store';

describe('PATCH /api/banking/transactions/[id] (DB-backed, real SQLite)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'banking-patch-route-test-'));

  beforeAll(() => {
    process.env.PETRICCO_DATA_DIR = tmpDir;
    initBudgetSchema();
    seedBudgetIfEmpty(); // Aug/2026
    createNextMonth(); // Sept/2026
    initBankSchema();

    upsertTransactions([
      {
        id: 'tx-aug',
        account_uid: 'acc-1',
        amount: -42.5,
        currency: 'EUR',
        credit_debit: 'DBIT',
        booking_date: '2026-08-12',
        value_date: '2026-08-12',
        description: 'Some Aug purchase',
        counterparty: null,
        status: 'BOOK',
      },
      {
        id: 'tx-no-month',
        account_uid: 'acc-1',
        amount: -10,
        currency: 'EUR',
        credit_debit: 'DBIT',
        booking_date: '2031-01-05',
        value_date: '2031-01-05',
        description: 'A month that has no budget yet',
        counterparty: null,
        status: 'BOOK',
      },
    ]);
  });

  afterAll(() => {
    delete process.env.PETRICCO_DATA_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function patch(id: string, body: unknown) {
    const req = new NextRequest(`http://localhost/api/banking/transactions/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return PATCH(req, { params: Promise.resolve({ id }) });
  }

  it('rejects a categoryId from a different month than the transaction (400)', async () => {
    const sepShop = getMonthByYM(2026, 9)!.categories.find((c) => c.name === 'Shop')!;

    const res = await patch('tx-aug', { categoryId: sepShop.id });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/does not belong/i);

    // Nothing was written.
    expect(getTransactionById('tx-aug')!.category_id).toBeNull();
  });

  it('accepts a categoryId from the transaction\'s own month (200)', async () => {
    const augShop = getMonthByYM(2026, 8)!.categories.find((c) => c.name === 'Shop')!;

    const res = await patch('tx-aug', { categoryId: augShop.id });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.categoryId).toBe(augShop.id);

    expect(getTransactionById('tx-aug')!.category_id).toBe(augShop.id);
  });

  it('rejects a categoryId when the transaction\'s own month has no budget month yet (400)', async () => {
    const res = await patch('tx-no-month', { categoryId: 'anything' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/no budget month/i);
  });

  it('404s for an unknown transaction id', async () => {
    const res = await patch('does-not-exist', { categoryId: 'anything' });
    expect(res.status).toBe(404);
  });

  it('accepts {ignored: true} and leaves the queue without touching category_id', async () => {
    const res = await patch('tx-no-month', { ignored: true });
    expect(res.status).toBe(200);
    const updated = getTransactionById('tx-no-month')!;
    expect(updated.ignored).toBe(1);
    expect(updated.category_id).toBeNull();
  });
});
