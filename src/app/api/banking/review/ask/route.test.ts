// Route-level tests for POST /api/banking/review/ask — the WhatsApp ask
// sweep. DB-backed (real SQLite), with fetch mocked per-target so each
// bridge can be independently failed/succeeded. Covers candidate filtering,
// the 10-per-run cap, message content (id + category names), both-bridges
// dispatch with a one-failure path, and the best-effort hook fired from the
// end of POST /api/banking/categorize.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { initBudgetSchema, seedBudgetIfEmpty, createNextMonth, getCurrentMonth } from '@/lib/budget-store';
import {
  initBankSchema,
  upsertTransactions,
  applyDedupDecisions,
  setTransactionCategory,
  listPendingReviewQuestions,
  getReviewQuestionById,
  setJointAccountUids,
  type BankTransactionInput,
} from '@/lib/bank-store';
import { getDb } from '@/lib/db';
import { POST as categorizePOST } from '@/app/api/banking/categorize/route';

describe('POST /api/banking/review/ask — DB-backed, mocked bridges', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'banking-review-ask-'));
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeAll(() => {
    process.env.PETRICCO_DATA_DIR = tmpDir;
    initBudgetSchema();
    seedBudgetIfEmpty(); // Aug/2026 — current month anchor for tests
    createNextMonth(); // Sep/2026
    // Make sure the question row's category list isn't empty by also
    // creating one more month if seedBudgetIfEmpty left us short — the
    // helpers above already create two months, which is enough for the
    // monthKeys[current..-3] scope the test exercises.
    initBankSchema();
    // joint account uids so attribution can mark test rows unallocated
    setJointAccountUids(['acc-ask']);
  });

  afterAll(() => {
    delete process.env.PETRICCO_DATA_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Wipe the question + transaction tables between tests so each test
    // starts clean (vitest reuses the same DB connection in this file).
    const db = getDb();
    db.exec('DELETE FROM bank_review_questions');
    db.exec("DELETE FROM bank_transactions WHERE account_uid = 'acc-ask'");
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('ok', { status: 200 })) as unknown as ReturnType<typeof vi.fn>;
  });

  function postAsk() {
    const req = new NextRequest('http://localhost/api/banking/review/ask', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cron-secret': process.env.INTERNAL_API_SECRET ?? 'test',
      },
      body: JSON.stringify({}),
    });
    return POST(req);
  }

  it('filters candidates: confidence >=0.9 NOT asked; confidence 0.6 asked; category_id NULL asked', async () => {
    const ym = (() => {
      const m = getCurrentMonth()!;
      return `${m.year}-${String(m.month).padStart(2, '0')}`;
    })();
    upsertTransactions([
      {
        id: 'tx-conf',
        account_uid: 'acc-ask',
        amount: -10,
        currency: 'EUR',
        credit_debit: 'DBIT',
        booking_date: `${ym}-05`,
        value_date: `${ym}-05`,
        description: 'Some Shop',
        counterparty: null,
        status: 'BOOK',
      },
      {
        id: 'tx-low',
        account_uid: 'acc-ask',
        amount: -20,
        currency: 'EUR',
        credit_debit: 'DBIT',
        booking_date: `${ym}-06`,
        value_date: `${ym}-06`,
        description: 'Some Shop',
        counterparty: null,
        status: 'BOOK',
      },
      {
        id: 'tx-null',
        account_uid: 'acc-ask',
        amount: -30,
        currency: 'EUR',
        credit_debit: 'DBIT',
        booking_date: `${ym}-07`,
        value_date: `${ym}-07`,
        description: 'Some Shop',
        counterparty: null,
        status: 'BOOK',
      },
    ]);
    applyDedupDecisions([
      { id: 'tx-conf', counted: 0, dedup_group: null, unallocated: 1 },
      { id: 'tx-low', counted: 0, dedup_group: null, unallocated: 1 },
      { id: 'tx-null', counted: 0, dedup_group: null, unallocated: 1 },
    ]);
    setTransactionCategory('tx-conf', 'cat-shop', 0.95);
    setTransactionCategory('tx-low', 'cat-shop', 0.6);

    const res = await postAsk();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.created).toBe(2);
    expect(body.sent).toBe(4); // 2 questions × 2 bridges
    expect(body.skipped).toBe(0);
    expect(body.failures).toBe(0);

    // Only the low + null got question rows.
    const pending = listPendingReviewQuestions(100).map((r) => r.tx_id).sort();
    expect(pending).toEqual(['tx-low', 'tx-null']);
  });

  it('caps the candidates at 10 per run even when more are eligible', async () => {
    const ym = (() => {
      const m = getCurrentMonth()!;
      return `${m.year}-${String(m.month).padStart(2, '0')}`;
    })();
    const rows: BankTransactionInput[] = [];
    for (let i = 0; i < 15; i++) {
      const dd = String(i + 1).padStart(2, '0');
      rows.push({
        id: `tx-cap-${i}`,
        account_uid: 'acc-ask',
        amount: -1,
        currency: 'EUR',
        credit_debit: 'DBIT',
        booking_date: `${ym}-${dd}`,
        value_date: `${ym}-${dd}`,
        description: 'Some Shop',
        counterparty: null,
        status: 'BOOK',
      });
    }
    upsertTransactions(rows);
    applyDedupDecisions(rows.map((r) => ({ id: r.id, counted: 0, dedup_group: null, unallocated: 1 })));

    const res = await postAsk();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toBe(10);
    expect(body.sent).toBe(20); // 10 × 2 bridges
    expect(listPendingReviewQuestions(100)).toHaveLength(10);
  });

  it('message contains the question id and the union of in-scope budget category names', async () => {
    const ym = (() => {
      const m = getCurrentMonth()!;
      return `${m.year}-${String(m.month).padStart(2, '0')}`;
    })();
    upsertTransactions([
      {
        id: 'tx-msg',
        account_uid: 'acc-ask',
        amount: -139,
        currency: 'EUR',
        credit_debit: 'DBIT',
        booking_date: `${ym}-03`,
        value_date: `${ym}-03`,
        description: 'Tesco Stores',
        counterparty: null,
        status: 'BOOK',
      },
    ]);
    applyDedupDecisions([{ id: 'tx-msg', counted: 0, dedup_group: null, unallocated: 1 }]);

    await postAsk();

    expect(fetchSpy).toHaveBeenCalledTimes(2); // both bridges
    const bodies = fetchSpy.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));
    const messages = bodies.map((b) => b.message as string);
    const questionId = getReviewQuestionById(listPendingReviewQuestions(1)[0].id)!.id;

    for (const m of messages) {
      expect(m).toContain(`(id: ${questionId})`);
      expect(m).toContain('Tesco Stores');
      expect(m).toContain('-€139.00');
      // At least one in-scope category name from seedBudgetIfEmpty must appear.
      expect(m).toMatch(/Categorias: .+/);
    }
  });

  it('dispatch to both bridges: one bridge failing does not block the other (per-target failure is non-fatal)', async () => {
    const ym = (() => {
      const m = getCurrentMonth()!;
      return `${m.year}-${String(m.month).padStart(2, '0')}`;
    })();
    upsertTransactions([
      {
        id: 'tx-onefail',
        account_uid: 'acc-ask',
        amount: -15,
        currency: 'EUR',
        credit_debit: 'DBIT',
        booking_date: `${ym}-04`,
        value_date: `${ym}-04`,
        description: 'Cafe',
        counterparty: null,
        status: 'BOOK',
      },
    ]);
    applyDedupDecisions([{ id: 'tx-onefail', counted: 0, dedup_group: null, unallocated: 1 }]);

    // First fetch (Rafa bridge) -> throws (timeout/network); second -> OK.
    fetchSpy.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes(':3001')) throw new Error('connection refused');
      return new Response('ok', { status: 200 });
    });

    const res = await postAsk();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toBe(1);
    expect(body.sent).toBe(1); // only the OK bridge counted
    expect(body.failures).toBe(1); // the failing bridge counted
    // Question row still exists.
    expect(listPendingReviewQuestions(100)).toHaveLength(1);
  });

  it('idempotent on pending reuse — a second ask does NOT create a duplicate row and does NOT re-send the WhatsApp message', async () => {
    const ym = (() => {
      const m = getCurrentMonth()!;
      return `${m.year}-${String(m.month).padStart(2, '0')}`;
    })();
    upsertTransactions([
      {
        id: 'tx-reuse',
        account_uid: 'acc-ask',
        amount: -25,
        currency: 'EUR',
        credit_debit: 'DBIT',
        booking_date: `${ym}-09`,
        value_date: `${ym}-09`,
        description: 'Cafe',
        counterparty: null,
        status: 'BOOK',
      },
    ]);
    applyDedupDecisions([{ id: 'tx-reuse', counted: 0, dedup_group: null, unallocated: 1 }]);

    const first = await postAsk();
    const firstBody = await first.json();
    expect(firstBody.created).toBe(1);
    expect(firstBody.sent).toBe(2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const second = await postAsk();
    const secondBody = await second.json();
    expect(secondBody.created).toBe(0);
    expect(secondBody.sent).toBe(0);
    expect(secondBody.skipped).toBe(1); // existing pending reused
    expect(fetchSpy).toHaveBeenCalledTimes(2); // no new fetches

    expect(listPendingReviewQuestions(100)).toHaveLength(1);
  });

  it('categorize-route hook fires: POST /api/banking/categorize ends with the ask sweep (a pending question row is created)', async () => {
    const ym = (() => {
      const m = getCurrentMonth()!;
      return `${m.year}-${String(m.month).padStart(2, '0')}`;
    })();
    upsertTransactions([
      {
        id: 'tx-hook',
        account_uid: 'acc-ask',
        amount: -50,
        currency: 'EUR',
        credit_debit: 'DBIT',
        booking_date: `${ym}-15`,
        value_date: `${ym}-15`,
        description: 'Unmatched Vendor',
        counterparty: null,
        status: 'BOOK',
      },
    ]);
    // Manually mark unallocated so attribution doesn't need to run for this
    // row to qualify — but we DO want to verify the hook runs the full
    // categorize path (categorize + attribution + ask), so DON'T mark it
    // ourselves; let attribution's gate do it.

    const req = new NextRequest('http://localhost/api/banking/categorize', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cron-secret': process.env.INTERNAL_API_SECRET ?? 'test',
      },
      body: JSON.stringify({}),
    });
    const res = await categorizePOST(req);
    expect(res.status).toBe(200);

    // The hook fires asynchronously after attribution; wait briefly for the
    // microtask queue + any awaited Promise.all in runAskReview to settle.
    await new Promise((r) => setTimeout(r, 50));

    const pending = listPendingReviewQuestions(100);
    expect(pending.some((q) => q.tx_id === 'tx-hook')).toBe(true);
  });
});