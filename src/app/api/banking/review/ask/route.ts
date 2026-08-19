import { NextRequest, NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/api-auth';
import {
  createReviewQuestion,
  expireStaleReviewQuestions,
  listAskCandidates,
  type BankTransactionRow,
} from '@/lib/bank-store';
import { getMonthByYM } from '@/lib/budget-store';
import { ensureBankReady } from '../../_ready';

// POST /api/banking/review/ask — internal/cron endpoint (x-cron-secret).
// Sweeps the candidate set (unallocated + low/null category), creates a
// review-question row per candidate, and posts a WhatsApp message to BOTH
// bridges (Rafa + Rafaela) so either can reply. Per-target send failures are
// non-fatal — logged and counted, the question row is still created.
//
// Exposed as `runAskReview` so the categorize route can hook this at the end
// of its run (best-effort, try/catch) without duplicating the logic.

const RAFA_CHAT_ID = '353830891504:81@s.whatsapp.net';
const RAFAELA_CHAT_ID = '353830805731:7@s.whatsapp.net';
const DEFAULT_RAFA_BRIDGE_URL = 'http://172.17.0.1:3001';
const DEFAULT_RAFAELA_BRIDGE_URL = 'http://172.17.0.1:3002';
const ASK_LOOKBACK_MONTHS = 4; // current + previous 3
const ASK_CAP = 10;
const BRIDGE_TIMEOUT_MS = 5000;

export interface AskReviewCounters {
  created: number;
  sent: number;
  skipped: number;
  failures: number;
  expired: number;
}

export function getMonthKeys(now: Date = new Date()): string[] {
  const out: string[] = [];
  for (let i = 0; i < ASK_LOOKBACK_MONTHS; i++) {
    let year = now.getUTCFullYear();
    let month = now.getUTCMonth() + 1 - i;
    while (month <= 0) {
      year -= 1;
      month += 12;
    }
    out.push(`${year}-${String(month).padStart(2, '0')}`);
  }
  return out;
}

function formatAmount(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}€${Math.abs(amount).toFixed(2)}`;
}

function formatDayMonth(date: string | null | undefined): string {
  if (!date) return '??/??';
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '??/??';
  return `${m[3]}/${m[2]}`;
}

function bridgeUrl(envName: string, defaultUrl: string): string {
  return process.env[envName] || defaultUrl;
}

async function sendToBridge(
  url: string,
  chatId: string,
  message: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${url}/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatId, message }),
      signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn('[review/ask] bridge responded non-OK', {
        url,
        chatId,
        status: res.status,
      });
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[review/ask] bridge send failed', {
      url,
      chatId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export function buildAskMessage(
  tx: Pick<BankTransactionRow, 'description' | 'amount' | 'booking_date'>,
  questionId: string,
  categoryNames: string[],
): string {
  return (
    `🤔 Lançamento: '${tx.description}' (${formatAmount(tx.amount)}) no dia ${formatDayMonth(tx.booking_date)}.\n` +
    `Em qual categoria do orçamento? Responde com o nome exato. Categorias: ${categoryNames.join(', ')}\n` +
    `(id: ${questionId})`
  );
}

export async function runAskReview(): Promise<AskReviewCounters> {
  const counters: AskReviewCounters = { created: 0, sent: 0, skipped: 0, failures: 0, expired: 0 };
  counters.expired = expireStaleReviewQuestions();

  const monthKeys = getMonthKeys();
  const budgetMonths = monthKeys
    .map((ym) => {
      const [y, m] = ym.split('-').map(Number);
      return getMonthByYM(y, m);
    })
    .filter((m): m is NonNullable<typeof m> => m != null);

  if (budgetMonths.length === 0) {
    return counters;
  }

  const categoryNames = Array.from(
    new Set(budgetMonths.flatMap((m) => m.categories.map((c) => c.name))),
  ).sort();

  const candidates = listAskCandidates(monthKeys, ASK_CAP);
  if (candidates.length === 0) {
    return counters;
  }

  const rafaUrl = bridgeUrl('REVIEW_RAFA_BRIDGE_URL', DEFAULT_RAFA_BRIDGE_URL);
  const rafaelaUrl = bridgeUrl('REVIEW_RAFAELA_BRIDGE_URL', DEFAULT_RAFAELA_BRIDGE_URL);

  for (const tx of candidates) {
    const result = createReviewQuestion({
      tx_id: tx.id,
      tx_date: tx.booking_date,
      tx_description: tx.description,
      tx_amount: tx.amount,
    });
    if (result === null) {
      counters.skipped++;
      continue;
    }
    if (!result.sent) {
      // existing pending row — already in flight, no new message
      counters.skipped++;
      continue;
    }
    counters.created++;
    const message = buildAskMessage(tx, result.row.id, categoryNames);
    const targets: Array<{ url: string; chatId: string }> = [
      { url: rafaUrl, chatId: RAFA_CHAT_ID },
      { url: rafaelaUrl, chatId: RAFAELA_CHAT_ID },
    ];
    const results = await Promise.all(
      targets.map((t) => sendToBridge(t.url, t.chatId, message)),
    );
    for (const ok of results) {
      if (ok) counters.sent++;
      else counters.failures++;
    }
  }

  return counters;
}

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

  try {
    ensureBankReady();
    const counters = await runAskReview();
    return NextResponse.json({ ok: true, ...counters });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown_error';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function GET(_req: NextRequest) {
  return NextResponse.json({ ok: false, error: 'method_not_allowed' }, { status: 405 });
}