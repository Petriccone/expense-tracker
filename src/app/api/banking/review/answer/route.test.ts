// Route-level tests for POST /api/banking/review/answer — claims a pending
// bank_review_questions row atomically and applies the chosen category to
// the underlying transaction, then re-runs attribution so the spend sum
// reflects the assign. DB-backed (real SQLite) against an isolated temp
// PETRICCO_HOME.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { initBudgetSchema, seedBudgetIfEmpty, createNextMonth, getMonthByYM } from '@/lib/budget-store';
import {
  initBankSchema,
  upsertTransactions,
  createReviewQuestion,
  claimReviewQuestion,
  getReviewQuestionById,
  listPendingReviewQuestions,
  setJointAccountUids,
  applyDedupDecisions,
  bankSpentByCategory,
  getTransactionById,
} from '@/lib/bank-store';
import { getDb } from '@/lib/db';

describe('POST /api/banking/review/answer (DB-backed, real SQLite)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'banking-review-answer-'));

  beforeAll(() => {
    process.env.PETRICCO_DATA_DIR = tmpDir;
    initBudgetSchema();
    seedBudgetIfEmpty(); // Aug/2026 — current month anchor
    createNextMonth(); // Sep/2026 — same names, different per-month ids
    initBankSchema();
    setJointAccountUids(['acc-joint']); // so the answer's attribution re-run can count the row
  });

  afterAll(() => {
    delete process.env.PETRICCO_DATA_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    const db = getDb();
    db.exec('DELETE FROM bank_review_questions');
    db.exec("DELETE FROM bank_transactions WHERE account_uid IN ('acc-joint','acc-other')");
  });

  function answer(body: unknown) {
    const req = new NextRequest('http://localhost/api/banking/review/answer', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cron-secret': process.env.INTERNAL_API_SECRET ?? 'test',
      },
      body: JSON.stringify(body),
    });
    return POST(req);
  }

  function seedQuestion(opts: { txBookingDate: string; txId?: string }): { txId: string; questionId: string } {
    const txId = opts.txId ?? 'tx-ans';
    upsertTransactions([
      {
        id: txId,
        account_uid: 'acc-joint',
        amount: -42.0,
        currency: 'EUR',
        credit_debit: 'DBIT',
        booking_date: opts.txBookingDate,
        value_date: opts.txBookingDate,
        description: 'Tesco',
        counterparty: null,
        status: 'BOOK',
      },
    ]);
    applyDedupDecisions([{ id: txId, counted: 1, dedup_group: null, unallocated: 0 }]);
    const r = createReviewQuestion({
      tx_id: txId,
      tx_date: opts.txBookingDate,
      tx_description: 'Tesco',
      tx_amount: -42.0,
    });
    if (!r) throw new Error('seed: could not create pending question');
    return { txId, questionId: r.row.id };
  }

  it('claim wins: assigns the chosen category with confidence 1.0, marks the question answered, and surfaces in bankSpentByCategory', async () => {
    const ym = getMonthByYM(2026, 8)!;
    const shopId = ym.categories.find((c) => c.name === 'Shop')!.id;

    const { questionId, txId } = seedQuestion({ txBookingDate: '2026-08-12' });

    const res = await answer({
      questionId,
      by: 'rafa',
      text: 'Shop',
      categoryId: shopId,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Question is answered by 'rafa'.
    const q = getReviewQuestionById(questionId)!;
    expect(q.status).toBe('answered');
    expect(q.answered_by).toBe('rafa');
    expect(q.chosen_category_id).toBe(shopId);
    expect(q.answer_text).toBe('Shop');

    // Transaction has the new category + confidence 1.0.
    const tx = getTransactionById(txId)!;
    expect(tx.category_id).toBe(shopId);
    expect(tx.confidence).toBeCloseTo(1.0, 5);

    // bankSpentByCategory reflects the assign after the post-claim attribution re-run.
    const spent = bankSpentByCategory(2026, 8);
    expect(spent[shopId]).toBeCloseTo(42.0, 2);
  });

  it('claim loses (second caller): 409, neither side writes, the first claimer\'s data is preserved', async () => {
    const ym = getMonthByYM(2026, 8)!;
    const shopId = ym.categories.find((c) => c.name === 'Shop')!.id;
    const gymId = ym.categories.find((c) => c.name === 'Gym')!.id;

    const { questionId } = seedQuestion({ txBookingDate: '2026-08-13' });

    // Directly claim it as rafa first so we have a clean "answered" state.
    expect(claimReviewQuestion(questionId, 'rafa', 'Shop', shopId)).toBe(true);

    const res = await answer({
      questionId,
      by: 'rafaela',
      text: 'Gym',
      categoryId: gymId,
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);

    const q = getReviewQuestionById(questionId)!;
    expect(q.status).toBe('answered');
    expect(q.answered_by).toBe('rafa');
    expect(q.chosen_category_id).toBe(shopId);
  });

  it('rejects a categoryId from a different month than the transaction (400) and leaves the question pending', async () => {
    const sepY = getMonthByYM(2026, 9)!;
    const sepShopId = sepY.categories.find((c) => c.name === 'Shop')!.id;

    const { questionId } = seedQuestion({ txBookingDate: '2026-08-14' });

    const res = await answer({
      questionId,
      by: 'rafa',
      text: 'Shop',
      categoryId: sepShopId, // Sep's id — wrong month for an Aug tx
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/does not belong/i);

    // Question still pending.
    expect(listPendingReviewQuestions(100).some((q) => q.id === questionId)).toBe(true);
  });

  it('400s on missing or invalid by', async () => {
    const { questionId } = seedQuestion({ txBookingDate: '2026-08-15' });
    const shopId = getMonthByYM(2026, 8)!.categories.find((c) => c.name === 'Shop')!.id;

    const missing = await answer({ questionId, text: 'Shop', categoryId: shopId });
    expect(missing.status).toBe(400);

    const wrong = await answer({ questionId, by: 'someone-else', text: 'Shop', categoryId: shopId });
    expect(wrong.status).toBe(400);

    // Question never got claimed.
    expect(listPendingReviewQuestions(100).some((q) => q.id === questionId)).toBe(true);
  });

  it('400s when categoryId is missing or not a string', async () => {
    const { questionId } = seedQuestion({ txBookingDate: '2026-08-16' });

    const noCat = await answer({ questionId, by: 'rafa', text: 'Shop' });
    expect(noCat.status).toBe(400);

    const wrongType = await answer({ questionId, by: 'rafa', text: 'Shop', categoryId: 123 });
    expect(wrongType.status).toBe(400);

    expect(listPendingReviewQuestions(100).some((q) => q.id === questionId)).toBe(true);
  });

  it('404s for an unknown questionId', async () => {
    const shopId = getMonthByYM(2026, 8)!.categories.find((c) => c.name === 'Shop')!.id;
    const res = await answer({ questionId: 'does-not-exist', by: 'rafa', text: 'Shop', categoryId: shopId });
    expect(res.status).toBe(404);
  });
});