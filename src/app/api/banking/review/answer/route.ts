import { NextRequest, NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/api-auth';
import {
  claimReviewQuestion,
  getReviewQuestionById,
  setTransactionCategory,
} from '@/lib/bank-store';
import { runAttribution } from '@/lib/attribution';
import { getMonthByYM } from '@/lib/budget-store';
import { ensureBankReady } from '../../_ready';

// POST /api/banking/review/answer — internal/cron endpoint (x-cron-secret).
// Claims a pending bank_review_questions row atomically (first writer wins),
// then assigns the chosen category to the underlying transaction (confidence
// 1.0 — a manual review IS a certainty) and re-runs attribution so the new
// category id is correctly placed under its budget month. categoryId must
// belong to the transaction's OWN booking month (per-month UUIDs); a wrong
// month returns 400.
//
// Body: {questionId: string, by: 'rafa' | 'rafaela', text?: string, categoryId: string}

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return NextResponse.json(
      { ok: false, error: 'content-type must be application/json' },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ ok: false, error: 'invalid request body' }, { status: 400 });
  }
  const { questionId, by, text, categoryId } = body as Record<string, unknown>;

  if (typeof questionId !== 'string' || !questionId) {
    return NextResponse.json({ ok: false, error: 'questionId is required' }, { status: 400 });
  }
  if (by !== 'rafa' && by !== 'rafaela') {
    return NextResponse.json(
      { ok: false, error: "by must be 'rafa' or 'rafaela'" },
      { status: 400 },
    );
  }
  if (typeof categoryId !== 'string' || !categoryId) {
    return NextResponse.json({ ok: false, error: 'categoryId is required' }, { status: 400 });
  }
  if (text !== undefined && text !== null && typeof text !== 'string') {
    return NextResponse.json({ ok: false, error: 'text must be a string' }, { status: 400 });
  }

  try {
    ensureBankReady();

    const question = getReviewQuestionById(questionId);
    if (!question) {
      return NextResponse.json({ ok: false, error: 'question not found' }, { status: 404 });
    }
    if (question.status !== 'pending') {
      return NextResponse.json(
        { ok: false, error: `question is ${question.status}, not pending` },
        { status: 409 },
      );
    }

    // Resolve the question's tx to validate categoryId against its booking
    // month (same per-month-UUID rule as PATCH /api/banking/transactions/[id]).
    // We import lazily to avoid a circular dep at module load.
    const { getTransactionById } = await import('@/lib/bank-store');
    const tx = getTransactionById(question.tx_id);
    if (!tx) {
      return NextResponse.json(
        { ok: false, error: `underlying transaction ${question.tx_id} not found` },
        { status: 404 },
      );
    }
    const ym = tx.booking_date?.match(/^(\d{4})-(\d{2})/);
    if (!ym) {
      return NextResponse.json(
        { ok: false, error: 'transaction has no booking date to resolve a budget month' },
        { status: 400 },
      );
    }
    const monthYear = `${ym[1]}-${ym[2]}`;
    const budgetMonth = getMonthByYM(Number(ym[1]), Number(ym[2]));
    if (!budgetMonth) {
      return NextResponse.json(
        { ok: false, error: `no budget month for ${monthYear} yet` },
        { status: 400 },
      );
    }
    if (!budgetMonth.categories.some((c) => c.id === categoryId)) {
      return NextResponse.json(
        {
          ok: false,
          error: `categoryId does not belong to this transaction's budget month (${monthYear})`,
        },
        { status: 400 },
      );
    }

    const won = claimReviewQuestion(
      questionId,
      by as 'rafa' | 'rafaela',
      typeof text === 'string' ? text : null,
      categoryId,
    );
    if (!won) {
      return NextResponse.json(
        { ok: false, error: 'question already claimed' },
        { status: 409 },
      );
    }

    setTransactionCategory(tx.id, categoryId, 1.0);

    // Best-effort re-attribution so the new category id is correctly placed
    // under its budget month and the spend sums reflect the assign. Non-fatal
    // — a failure here is logged but does not undo the claim.
    try {
      runAttribution();
    } catch (err) {
      console.error(
        '[review/answer] post-claim attribution failed',
        err instanceof Error ? err.message : err,
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown_error';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function GET(_req: NextRequest) {
  return NextResponse.json({ ok: false, error: 'method_not_allowed' }, { status: 405 });
}