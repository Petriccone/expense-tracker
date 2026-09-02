import { NextRequest, NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/api-auth';
import {
  createReviewQuestion,
  expireStaleReviewQuestions,
  listAskCandidates,
  listPendingReviewQuestions,
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
    // The WhatsApp bridges bind loopback-only by default; the app reaches the
    // opt-in docker0 listener, which requires the shared token.
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      Host: new URL(url).host,
    };
    const token = process.env.REVIEW_BRIDGE_TOKEN;
    if (token) headers['x-bridge-token'] = token;
    const res = await fetch(`${url}/send`, {
      method: 'POST',
      headers,
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

// Categories shown as numbered reply options. Cap keeps the message
// glanceable — if a month genuinely has more lines than this the user can
// still reply with the exact name.
const ASK_OPTION_CAP = 12;

export function askOptionsFor(categoryNames: string[]): string[] {
  return categoryNames.slice(0, ASK_OPTION_CAP);
}

export function buildAskMessage(
  tx: Pick<BankTransactionRow, 'description' | 'amount' | 'booking_date'>,
  questionId: string,
  categoryNames: string[],
): string {
  const options = askOptionsFor(categoryNames);
  const lines: string[] = [
    '💸 *Gasto da conjunta pra lançar*',
    '',
    `*${formatAmount(tx.amount)}* · ${formatDayMonth(tx.booking_date)}`,
    `_${tx.description}_`,
    '',
    'Em qual categoria? Responde com o *número*:',
  ];
  options.forEach((name, i) => {
    const emoji = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'][i] ?? `${i + 1}.`;
    lines.push(`${emoji} ${name}`);
  });
  if (categoryNames.length > options.length) {
    lines.push('… ou responde com o nome exato de outra categoria.');
  }
  lines.push('', `_ref: ${questionId.slice(0, 8)}_`);
  return lines.join('\n');
}

// The couple's budget counts only LABELED transfers out of the joint account
// (the label IS the budget line). Merchant card charges (Tesco, OpenAI, …)
// are spending already-allocated money — they must never become questions.
// A joint outflow transfer carries the ASPSP's "… To <name>" shape; merchant
// descriptions don't. This filter keeps the ask sweep quiet by design: it
// asks ONLY about transfers the auto-categorizer couldn't confidently place.
const TRANSFER_DESCRIPTION_RE = /\bto\s+\S/i;

export function isAskableTransfer(tx: Pick<BankTransactionRow, 'description' | 'amount'>): boolean {
  return tx.amount < 0 && TRANSFER_DESCRIPTION_RE.test(tx.description);
}

export async function runAskReview(): Promise<AskReviewCounters> {
  const counters: AskReviewCounters = { created: 0, sent: 0, skipped: 0, failures: 0, expired: 0 };

  // Kill switch: REVIEW_ASK_ENABLED=false disables the whole WhatsApp ask
  // sweep (both this route and the post-categorize hook) without undeploying
  // anything. Pending question rows are untouched — replies still resolve.
  if (process.env.REVIEW_ASK_ENABLED === 'false') {
    return counters;
  }

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

  const categoriesByYm = new Map(budgetMonths.map((m) => [`${m.year}-${String(m.month).padStart(2, '0')}`, m.categories.map((c) => c.name).sort()]));

  const candidates = listAskCandidates(monthKeys, ASK_CAP).filter((tx) => {
    if (!isAskableTransfer(tx)) {
      // Merchant charge / inflow / unlabeled noise: not a budget event. Skip
      // WITHOUT creating a question row so it can be asked later if it
      // somehow becomes relevant — but mostly it just stays out of the way.
      counters.skipped++;
      return false;
    }
    return true;
  });
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
    const ym = (tx.booking_date ?? '').slice(0, 7);
    const monthCategoryNames = categoriesByYm.get(ym) ?? [];
    const message = buildAskMessage(tx, result.row.id, monthCategoryNames);
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

// GET /api/banking/review/ask — list pending questions (x-cron-secret).
// The agent reads this when someone replies to an ask message on WhatsApp:
// it maps the reply (option number or category name) to the question id and
// the month's category ids, then calls POST /api/banking/review/answer.
export async function GET(req: NextRequest) {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  try {
    ensureBankReady();
    const pending = listPendingReviewQuestions(50);
    const enriched = pending.map((q) => {
      const ym = (q.tx_date ?? '').slice(0, 7);
      const [y, m] = ym.split('-').map(Number);
      const month = Number.isFinite(y) && Number.isFinite(m) ? getMonthByYM(y, m) : null;
      return {
        id: q.id,
        ref: q.id.slice(0, 8),
        asked_at: q.asked_at,
        tx: {
          description: q.tx_description,
          amount: q.tx_amount,
          date: q.tx_date,
        },
        options: askOptionsFor((month?.categories ?? []).map((c) => c.name).sort()),
      };
    });
    return NextResponse.json({ ok: true, count: enriched.length, questions: enriched });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown_error';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}