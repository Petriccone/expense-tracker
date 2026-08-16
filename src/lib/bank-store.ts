// Server-side store for Enable Banking data: sessions (consent + linked
// accounts), pulled transactions, and small key/value settings (last-sync
// timestamp, the pending OAuth-style `state` for the connect/callback CSRF
// check). Reuses the shared node:sqlite connection from `./db` (same
// file-backed DB, /data volume) and leaves every other table untouched.
//
// Row convention: node:sqlite's .all()/.get() return plain objects keyed by
// column name — same as budget-store.ts / read-store.ts.
//
// See docs/2026-08-15-agent-and-bank-automation-design.md (Phase 2a).

import { getDb } from './db';
import { getMonthByYM } from './budget-store';

let _schemaReady = false;

export function initBankSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS bank_sessions (
      session_id   TEXT PRIMARY KEY,
      account_uids TEXT NOT NULL,
      valid_until  TEXT,
      aspsp        TEXT,
      created_at   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bank_transactions (
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
    CREATE INDEX IF NOT EXISTS idx_bank_tx_booking_date ON bank_transactions(booking_date);
    CREATE INDEX IF NOT EXISTS idx_bank_tx_account ON bank_transactions(account_uid);

    CREATE TABLE IF NOT EXISTS bank_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // `ignored` (wave 2b — the "não-é-gasto" review-queue resolution) post-dates
  // the original CREATE TABLE, so a DB created before this change won't have
  // it. CREATE TABLE IF NOT EXISTS above only helps a brand-new DB; SQLite
  // has no "ADD COLUMN IF NOT EXISTS", so check PRAGMA table_info first —
  // idempotent either way.
  const cols = db.prepare('PRAGMA table_info(bank_transactions)').all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'ignored')) {
    db.exec('ALTER TABLE bank_transactions ADD COLUMN ignored INTEGER NOT NULL DEFAULT 0');
  }

  _schemaReady = true;
}

function ready(): ReturnType<typeof getDb> {
  const db = getDb();
  if (!_schemaReady) initBankSchema();
  return db;
}

// ----- sessions -----

export interface BankSessionRow {
  session_id: string;
  account_uids: string[];
  valid_until: string | null;
  aspsp: string | null;
  created_at: string;
}

interface SessionDbRow {
  session_id: string;
  account_uids: string;
  valid_until: string | null;
  aspsp: string | null;
  created_at: string;
}

const SESSION_SELECT =
  'SELECT session_id, account_uids, valid_until, aspsp, created_at FROM bank_sessions';

function mapSession(r: SessionDbRow): BankSessionRow {
  let account_uids: string[] = [];
  try {
    const parsed = JSON.parse(r.account_uids);
    if (Array.isArray(parsed)) account_uids = parsed;
  } catch {
    // corrupt/legacy row — treat as "no linked accounts" rather than throwing
  }
  return {
    session_id: r.session_id,
    account_uids,
    valid_until: r.valid_until,
    aspsp: r.aspsp,
    created_at: r.created_at,
  };
}

export function saveSession(input: {
  session_id: string;
  account_uids: string[];
  valid_until: string | null;
  aspsp: string | null;
}): BankSessionRow {
  const db = ready();
  db.prepare(
    `
    INSERT INTO bank_sessions (session_id, account_uids, valid_until, aspsp, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      account_uids = excluded.account_uids,
      valid_until = excluded.valid_until,
      aspsp = excluded.aspsp
  `,
  ).run(
    input.session_id,
    JSON.stringify(input.account_uids),
    input.valid_until,
    input.aspsp,
    new Date().toISOString(),
  );
  const r = db.prepare(`${SESSION_SELECT} WHERE session_id = ?`).get(input.session_id) as SessionDbRow;
  return mapSession(r);
}

export function getSession(sessionId: string): BankSessionRow | null {
  const db = ready();
  const r = db.prepare(`${SESSION_SELECT} WHERE session_id = ?`).get(sessionId) as
    | SessionDbRow
    | undefined;
  return r ? mapSession(r) : null;
}

// The most recently created session — the "active" connection. A reconnect
// creates a new session_id rather than overwriting the old one, so this is
// how routes find "the" current linked accounts.
export function getLatestSession(): BankSessionRow | null {
  const db = ready();
  const r = db.prepare(`${SESSION_SELECT} ORDER BY created_at DESC LIMIT 1`).get() as
    | SessionDbRow
    | undefined;
  return r ? mapSession(r) : null;
}

// ----- transactions -----

export interface BankTransactionInput {
  id: string;
  account_uid: string;
  amount: number;
  currency: string | null;
  credit_debit: string | null;
  booking_date: string | null;
  value_date: string | null;
  description: string;
  counterparty: string | null;
  status: string | null;
}

export interface BankTransactionRow extends BankTransactionInput {
  category_id: string | null;
  confidence: number | null;
  ignored: number;
  created_at: string;
}

const TX_SELECT = `
  SELECT id, account_uid, amount, currency, credit_debit, booking_date, value_date,
         description, counterparty, status, category_id, confidence, ignored, created_at
  FROM bank_transactions
`;

// INSERT OR IGNORE dedups on id (the bank's transaction_id for booked rows,
// or the deterministic hash fallback from enablebanking.ts's
// transactionDedupId otherwise) — re-syncing an overlapping window never
// duplicates a row. category_id/confidence are left NULL here; wave 2b's
// categorizer assigns them separately.
//
// Booked-only model: callers (sync/callback routes, via
// enablebanking.ts's mapTransaction/mapTransactionBatch) only ever pass rows
// with status === 'BOOK' — pending rows are filtered out before they reach
// here. So there's nothing to reconcile or delete: a plain insert-dedup is
// correct even though each sync only fetches a narrow date window (a pending
// row aging out of that window was never stored in the first place, so
// there's nothing left stale to clean up).
//
// Wrapped in a single transaction — this runs against the full 730-day
// backfill batch, not just incremental syncs.
export function upsertTransactions(rows: BankTransactionInput[]): {
  inserted: number;
  duplicates: number;
} {
  if (rows.length === 0) return { inserted: 0, duplicates: 0 };
  const db = ready();
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO bank_transactions
      (id, account_uid, amount, currency, credit_debit, booking_date, value_date,
       description, counterparty, status, category_id, confidence, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
  `);

  let inserted = 0;
  const now = new Date().toISOString();

  db.exec('BEGIN');
  try {
    for (const r of rows) {
      const res = insertStmt.run(
        r.id,
        r.account_uid,
        r.amount,
        r.currency,
        r.credit_debit,
        r.booking_date,
        r.value_date,
        r.description,
        r.counterparty,
        r.status,
        now,
      );
      if (((res as { changes?: number }).changes ?? 0) > 0) inserted++;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { inserted, duplicates: rows.length - inserted };
}

export function listTransactions(opts: { since?: string; limit?: number } = {}): BankTransactionRow[] {
  const db = ready();
  const conds: string[] = [];
  const params: unknown[] = [];
  if (opts.since !== undefined) {
    conds.push('booking_date >= ?');
    params.push(opts.since);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const limit = opts.limit ?? 1000;
  params.push(limit);
  return db
    .prepare(`${TX_SELECT} ${where} ORDER BY booking_date DESC LIMIT ?`)
    .all(...params) as unknown as BankTransactionRow[];
}

export function countTransactions(): number {
  const db = ready();
  const r = db.prepare('SELECT COUNT(*) AS n FROM bank_transactions').get() as { n: number };
  return r.n;
}

// Half away from zero, epsilon-nudged to defeat binary float artefacts —
// same convention as budget-store.ts's round2, kept as a separate copy since
// each store stays self-contained.
function round2(n: number): number {
  return (Math.sign(n) * Math.round(Math.abs(n) * 100 + Number.EPSILON)) / 100;
}

// Wave 2b (categorization + review queue). `monthYear` is 'YYYY-MM' and
// filters on the booking_date prefix (booking_date is always 'YYYY-MM-DD' for
// booked rows). status='uncategorized' -> category_id IS NULL AND ignored=0
// (a dismissed "não-é-gasto" row must not keep reappearing in the queue);
// 'all' or omitted -> no category/ignored filter.
export function listBankTransactions(
  opts: { monthYear?: string; status?: 'uncategorized' | 'all' } = {},
): BankTransactionRow[] {
  const db = ready();
  const conds: string[] = [];
  const params: unknown[] = [];
  if (opts.monthYear !== undefined) {
    conds.push('booking_date LIKE ?');
    params.push(`${opts.monthYear}-%`);
  }
  if (opts.status === 'uncategorized') {
    conds.push('category_id IS NULL');
    conds.push('ignored = 0');
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  return db
    .prepare(`${TX_SELECT} ${where} ORDER BY booking_date DESC`)
    .all(...params) as unknown as BankTransactionRow[];
}

// A single transaction by id, or null. Used by the PATCH review-assign route
// to resolve the transaction's own booking month before validating a
// categoryId against it.
export function getTransactionById(id: string): BankTransactionRow | null {
  const db = ready();
  const r = db.prepare(`${TX_SELECT} WHERE id = ?`).get(id) as BankTransactionRow | undefined;
  return r ?? null;
}

// Category ids are per-month UUIDs (see budget-store.ts) — a category from
// month X assigned to a transaction booked in month Y would never show up in
// bankSpentByCategory(Y), because Y's category list doesn't contain that id.
// This is best-effort, deliberately LENIENT defense-in-depth for
// setTransactionCategory: it only rejects a categoryId it can *prove* wrong
// (tx's own budget month exists and doesn't contain it) and otherwise
// allows, e.g. when there's no booking date or no budget month for that
// year/month yet. The strict, user-facing version of this check — which
// does reject those cases with a 400 — lives in the PATCH route
// (src/app/api/banking/transactions/[id]/route.ts); this guard exists so a
// future caller that skips the route's own check still can't silently write
// an id we can prove doesn't belong. See
// docs/2026-08-15-agent-and-bank-automation-design.md (wave 2b fix).
function categoryKnownWrongForTransaction(
  tx: Pick<BankTransactionRow, 'booking_date'>,
  categoryId: string,
): boolean {
  const ym = tx.booking_date?.match(/^(\d{4})-(\d{2})/);
  if (!ym) return false; // can't resolve a month — don't block
  const month = getMonthByYM(Number(ym[1]), Number(ym[2]));
  if (!month) return false; // no budget month yet — nothing to check against
  return !month.categories.some((c) => c.id === categoryId);
}

// Manual review-assign (PATCH /api/banking/transactions/[id]) and the
// categorizer's (categorize.ts) auto-assign both funnel through here.
// confidence defaults to null (a manual assign has no "confidence" — it's a
// certainty).
export function setTransactionCategory(
  id: string,
  categoryId: string,
  confidence: number | null = null,
): BankTransactionRow {
  const db = ready();
  const existing = db.prepare(`${TX_SELECT} WHERE id = ?`).get(id) as BankTransactionRow | undefined;
  if (!existing) throw new Error(`bank: transaction ${id} not found`);

  if (categoryKnownWrongForTransaction(existing, categoryId)) {
    throw new Error(`bank: categoryId ${categoryId} does not belong to transaction ${id}'s budget month`);
  }

  db.prepare('UPDATE bank_transactions SET category_id = ?, confidence = ? WHERE id = ?').run(
    categoryId,
    confidence,
    id,
  );
  return db.prepare(`${TX_SELECT} WHERE id = ?`).get(id) as BankTransactionRow;
}

// The "ignorar" review-queue action — marks a transaction as deliberately
// not a spend (e.g. a Revolut top-up the rules recognize but never assign a
// category to, see categorize.ts's RULES). Leaves category_id untouched;
// listBankTransactions(status='uncategorized') excludes ignored=1 rows so
// this is what actually removes it from the queue.
export function setTransactionIgnored(id: string, ignored: boolean): BankTransactionRow {
  const db = ready();
  const existing = db.prepare(`${TX_SELECT} WHERE id = ?`).get(id) as BankTransactionRow | undefined;
  if (!existing) throw new Error(`bank: transaction ${id} not found`);

  db.prepare('UPDATE bank_transactions SET ignored = ? WHERE id = ?').run(ignored ? 1 : 0, id);
  return db.prepare(`${TX_SELECT} WHERE id = ?`).get(id) as BankTransactionRow;
}

// Displayed "gasto" = budget_categories.spent (manual) + this (bank-derived).
// Only booked, categorized transactions in the given month count — matches
// the design doc's non-destructive reconciliation (budget-store's own
// `spent` column is never touched).
export function bankSpentByCategory(year: number, month: number): Record<string, number> {
  const db = ready();
  const monthYear = `${year}-${String(month).padStart(2, '0')}`;
  const rows = db
    .prepare(
      `SELECT category_id, SUM(ABS(amount)) AS total
       FROM bank_transactions
       WHERE status = 'BOOK' AND category_id IS NOT NULL AND booking_date LIKE ?
       GROUP BY category_id`,
    )
    .all(`${monthYear}-%`) as unknown as Array<{ category_id: string; total: number }>;

  const out: Record<string, number> = {};
  for (const r of rows) out[r.category_id] = round2(r.total);
  return out;
}

// ----- settings (generic key/value) -----

export function getSetting(key: string): string | null {
  const db = ready();
  const r = db.prepare('SELECT value FROM bank_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return r ? r.value : null;
}

export function setSetting(key: string, value: string): void {
  const db = ready();
  db.prepare(
    'INSERT INTO bank_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

function deleteSetting(key: string): void {
  const db = ready();
  db.prepare('DELETE FROM bank_settings WHERE key = ?').run(key);
}

const LAST_SYNC_KEY = 'last_sync_at';
const PENDING_STATE_KEY = 'pending_state';
const RATE_LIMITED_UNTIL_KEY = 'rate_limited_until';

export function getLastSyncAt(): string | null {
  return getSetting(LAST_SYNC_KEY);
}

export function setLastSyncAt(iso: string): void {
  setSetting(LAST_SYNC_KEY, iso);
}

// Persisted ASPSP rate-limit backoff. Set by /api/banking/sync when Enable
// Banking returns ASPSP_RATE_LIMIT_EXCEEDED; checked at the top of the next
// sync so a redeploy/restart/cron re-invocation doesn't forget the backoff
// and immediately hammer the bank again.
export function getRateLimitedUntil(): string | null {
  return getSetting(RATE_LIMITED_UNTIL_KEY);
}

export function setRateLimitedUntil(iso: string): void {
  setSetting(RATE_LIMITED_UNTIL_KEY, iso);
}

interface PendingStateValue {
  state: string;
  created_at: number;
}

const PENDING_STATE_TTL_MS = 15 * 60 * 1000; // 15 minutes

// The `state` minted by /api/banking/connect, checked against the callback's
// ?state= (anti-CSRF on the bank redirect). Stored server-side rather than in
// a cookie — the redirect round-trips through the bank's own domain, and
// this is a single-user app so there's no session to key it off. Stored with
// a creation timestamp so an abandoned/replayed redirect can't pass the CSRF
// check indefinitely — a value older than PENDING_STATE_TTL_MS is treated as
// if none were set.
export function getPendingState(): string | null {
  const raw = getSetting(PENDING_STATE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PendingStateValue;
    if (!parsed.state || typeof parsed.created_at !== 'number') return null;
    if (Date.now() - parsed.created_at > PENDING_STATE_TTL_MS) return null;
    return parsed.state;
  } catch {
    return null; // legacy/corrupt value — treat as expired
  }
}

export function setPendingState(state: string): void {
  setSetting(PENDING_STATE_KEY, JSON.stringify({ state, created_at: Date.now() } satisfies PendingStateValue));
}

export function clearPendingState(): void {
  deleteSetting(PENDING_STATE_KEY);
}
