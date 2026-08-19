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

import crypto from 'node:crypto';
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
      budget_month TEXT,
      counted      INTEGER NOT NULL DEFAULT 1,
      dedup_group  TEXT,
      move_reason  TEXT,
      unallocated  INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bank_tx_booking_date ON bank_transactions(booking_date);
    CREATE INDEX IF NOT EXISTS idx_bank_tx_account ON bank_transactions(account_uid);
    -- NB: the budget_month index is created AFTER the ALTER-if-missing block
    -- below, NOT here. On a pre-existing (old-schema) DB the CREATE TABLE above
    -- no-ops, so budget_month does not exist yet -- indexing it here would
    -- throw no-such-column before the migration ever runs.

    CREATE TABLE IF NOT EXISTS bank_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bank_category_rules (
      id            TEXT PRIMARY KEY,
      match_field   TEXT NOT NULL DEFAULT 'counterparty',
      pattern       TEXT NOT NULL,
      category_name TEXT NOT NULL,
      created_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bank_review_questions (
      id                TEXT PRIMARY KEY,
      tx_id             TEXT NOT NULL UNIQUE,
      tx_date           TEXT,
      tx_description    TEXT,
      tx_amount         REAL,
      asked_at          TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','answered','expired')),
      answered_by       TEXT NULL CHECK(answered_by IN ('rafa','rafaela')),
      answered_at       TEXT NULL,
      chosen_category_id TEXT NULL,
      answer_text       TEXT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bank_review_status_asked ON bank_review_questions(status, asked_at);
  `);

  // Columns added after the original CREATE TABLE — a DB created before each
  // change won't have them. CREATE TABLE IF NOT EXISTS above only helps a
  // brand-new DB; SQLite has no "ADD COLUMN IF NOT EXISTS", so check PRAGMA
  // table_info first — idempotent either way.
  //
  //  - `ignored`  (wave 2b): the "não-é-gasto" review-queue resolution.
  //  - `budget_month` / `counted` / `dedup_group` / `move_reason` (wave 2c,
  //    the intelligence layer — internal-transfer de-dup + plan-aware month
  //    attribution). See src/lib/attribution.ts.
  //  - `unallocated` (wave 2d, the allocation-only model): 1 marks a row whose
  //    label matches NO budget category name — a merchant card charge or an
  //    internal move (salary/savings/rollover). It never counts toward category
  //    spend; only the labeled ALLOCATIONS do. See src/lib/attribution.ts.
  //
  // SQLite column DEFAULT can't reference another column, so `budget_month`
  // (whose default IS the booking month) is added nullable and then
  // backfilled from booking_date below; `counted` is a constant DEFAULT 1, so
  // existing rows pick it up automatically on ADD COLUMN.
  const cols = db.prepare('PRAGMA table_info(bank_transactions)').all() as Array<{ name: string }>;
  const has = (name: string): boolean => cols.some((c) => c.name === name);
  if (!has('ignored')) {
    db.exec('ALTER TABLE bank_transactions ADD COLUMN ignored INTEGER NOT NULL DEFAULT 0');
  }
  if (!has('budget_month')) {
    db.exec('ALTER TABLE bank_transactions ADD COLUMN budget_month TEXT');
  }
  if (!has('counted')) {
    db.exec('ALTER TABLE bank_transactions ADD COLUMN counted INTEGER NOT NULL DEFAULT 1');
  }
  if (!has('dedup_group')) {
    db.exec('ALTER TABLE bank_transactions ADD COLUMN dedup_group TEXT');
  }
  if (!has('move_reason')) {
    db.exec('ALTER TABLE bank_transactions ADD COLUMN move_reason TEXT');
  }
  // `unallocated` is a constant DEFAULT 0, so existing rows backfill to 0
  // automatically on ADD COLUMN.
  if (!has('unallocated')) {
    db.exec('ALTER TABLE bank_transactions ADD COLUMN unallocated INTEGER NOT NULL DEFAULT 0');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_bank_tx_budget_month ON bank_transactions(budget_month)');

  // Backfill budget_month = booking month for any row missing it (existing
  // rows on the first run after this migration, plus any row that somehow
  // slipped in without it). Idempotent — the WHERE keeps it a no-op afterwards.
  db.exec(
    "UPDATE bank_transactions SET budget_month = substr(booking_date, 1, 7) " +
      'WHERE budget_month IS NULL AND booking_date IS NOT NULL',
  );

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
  // Intelligence layer (wave 2c, src/lib/attribution.ts):
  //  - budget_month: the month this spend is attributed to ('YYYY-MM'),
  //    which may differ from the booking month after a plan-aware move.
  //  - counted: 0 marks an internal-transfer mirror leg (excluded from spend).
  //  - dedup_group: links the two legs of a de-duplicated internal transfer.
  //  - move_reason: human-readable note when a month was reassigned / flagged.
  //  - unallocated: 1 = label matched no category name (merchant charge or an
  //    internal move) — never counted; queryable via listUnallocated.
  budget_month: string | null;
  counted: number;
  dedup_group: string | null;
  move_reason: string | null;
  unallocated: number;
  created_at: string;
}

const TX_SELECT = `
  SELECT id, account_uid, amount, currency, credit_debit, booking_date, value_date,
         description, counterparty, status, category_id, confidence, ignored,
         budget_month, counted, dedup_group, move_reason, unallocated, created_at
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
  // budget_month defaults to the booking month at insert (SQLite can't express
  // that as a column DEFAULT). category_id/confidence stay NULL (the
  // categorizer assigns them later); counted/dedup_group/move_reason take
  // their column defaults (counted = 1). runAttribution recomputes counted and
  // budget_month afterwards.
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO bank_transactions
      (id, account_uid, amount, currency, credit_debit, booking_date, value_date,
       description, counterparty, status, category_id, confidence, budget_month, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
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
        r.booking_date ? r.booking_date.slice(0, 7) : null,
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
// not a spend (e.g. a Revolut top-up: a self-transfer that matches no category
// name, so categorize.ts never assigns it one). Leaves category_id untouched;
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
//
// Joint-only signed-net model (2026-08-16, supersedes the internal-transfer
// de-dup model). Per (category, attributed month) the bank-derived spend is the
// NET SIGNED FLOW in the JOINT account only:
//   - Scope: the JOINT account uid(s) (bank_settings.joint_account_uids) ONLY.
//     Personal-account rows are the other side of a joint move / personal money
//     and never touch category spend.
//   - Sign: a DBIT (money leaving the joint account) ADDS to spend; a CRDT
//     (money coming back — a return/refund) SUBTRACTS. So a reversed allocation
//     nets to zero and the real net payment is captured automatically, with no
//     special reversal detection.
//   - Only counted = 1 rows contribute — attribution.ts sets that for a JOINT,
//     INTERNAL, category-matched row. Merchant charges and external credits are
//     counted = 0 and never enter the sum (an external credit can therefore
//     never SUBTRACT from — i.e. hide — real spend).
//   - Sums the ATTRIBUTED month (budget_month), not the booking month, so a
//     payday allocation the attribution layer moved to the month its salary
//     funds is counted where it belongs.
//   - A category whose net is NEGATIVE (returns exceed outflows — anomalous) is
//     clamped to 0 in the displayed total and surfaced via bankSpentAnomalies;
//     a negative never leaks into a budget total.
// budget-store's own `spent` column is never touched (non-destructive).
export function bankSpentByCategory(year: number, month: number): Record<string, number> {
  return computeBankSpend(year, month).spent;
}

// Category ids to surface for review: those whose RAW net went negative (returns
// exceeded outflows — clamped to 0 in bankSpentByCategory), PLUS those whose
// counted total was pulled down by returns above RETURN_ANOMALY_EUR even while
// the net stayed positive — so a refund quietly cancelling real spend (partial
// masking) is reviewable, not only the net-negative case (security HIGH-B).
export function bankSpentAnomalies(year: number, month: number): string[] {
  return computeBankSpend(year, month).anomalies;
}

// A return that reduced a category's counted total by more than this is worth a
// human glance; below it is rounding noise. One euro: bigger than any float
// artefact, small enough to catch a real refund against a real category.
const RETURN_ANOMALY_EUR = 1;

function computeBankSpend(
  year: number,
  month: number,
): { spent: Record<string, number>; anomalies: string[] } {
  const db = ready();
  const monthYear = `${year}-${String(month).padStart(2, '0')}`;

  // Joint-only scope. With no joint account configured the model cannot compute
  // joint-only spend, so return nothing (and warn) rather than silently summing
  // personal-account rows — which would double-count the other side of moves.
  const joint = getJointAccountUids();
  if (joint.length === 0) {
    console.warn(
      '[bank] joint_account_uids not configured — bankSpentByCategory returns no spend (the joint-only model needs it set)',
    );
    return { spent: {}, anomalies: [] };
  }

  const placeholders = joint.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT category_id,
              SUM(CASE WHEN credit_debit = 'DBIT' THEN ABS(amount) ELSE -ABS(amount) END) AS net,
              SUM(CASE WHEN credit_debit = 'DBIT' THEN 0 ELSE ABS(amount) END) AS returns
       FROM bank_transactions
       WHERE counted = 1 AND category_id IS NOT NULL AND budget_month = ?
         AND account_uid IN (${placeholders})
       GROUP BY category_id`,
    )
    .all(monthYear, ...joint) as unknown as Array<{ category_id: string; net: number; returns: number }>;

  const spent: Record<string, number> = {};
  const anomalies: string[] = [];
  for (const r of rows) {
    const net = round2(r.net);
    const returns = round2(r.returns);
    if (net < 0) {
      anomalies.push(r.category_id);
      console.warn(
        '[bank] category net spend is negative (returns exceed outflows) — clamped to 0 and flagged for review',
        { category_id: r.category_id, month: monthYear, net },
      );
      spent[r.category_id] = 0;
    } else {
      spent[r.category_id] = net;
      // Net is fine, but a sizable return quietly reduced the counted total —
      // surface it so a masking refund can't hide inside a still-positive total.
      if (returns > RETURN_ANOMALY_EUR) {
        anomalies.push(r.category_id);
        console.warn(
          '[bank] category counted total was reduced by returns above the review threshold — flagged for review (possible masking)',
          { category_id: r.category_id, month: monthYear, net, returns },
        );
      }
    }
  }
  return { spent, anomalies };
}

// ----- intelligence layer (wave 2c) persistence -----
//
// These back src/lib/attribution.ts's runAttribution(). Kept in the store so
// attribution.ts never touches the DB connection directly — same data-access
// boundary as the rest of this file.

// Every stored transaction, oldest booking first — the full set the
// de-dup + attribution recompute operates over (a couple's two accounts over
// ~2 years is a few hundred rows, so no pagination needed here).
export function listAllBankTransactions(): BankTransactionRow[] {
  const db = ready();
  return db
    .prepare(`${TX_SELECT} ORDER BY booking_date ASC, id ASC`)
    .all() as unknown as BankTransactionRow[];
}

// Bulk-apply the de-dup + allocation pass: counted (0 = mirror leg OR an
// unallocated row), the group linking the two legs of a transfer, and
// unallocated (1 = label matched no category name). Authoritative full
// recompute — a row no longer part of any pair / now allocated is reset
// accordingly (unallocated defaults to 0 when a decision omits it). One
// transaction for atomicity.
export function applyDedupDecisions(
  decisions: Array<{ id: string; counted: number; dedup_group: string | null; unallocated?: number }>,
): void {
  if (decisions.length === 0) return;
  const db = ready();
  const stmt = db.prepare(
    'UPDATE bank_transactions SET counted = ?, dedup_group = ?, unallocated = ? WHERE id = ?',
  );
  db.exec('BEGIN');
  try {
    for (const d of decisions) stmt.run(d.counted, d.dedup_group, d.unallocated ?? 0, d.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// The "precisa alocar" review list: rows the allocation-only model did not
// count toward a category. Two kinds (attribution.ts marks both unallocated=1,
// counted=0): EXTERNAL merchant charges / incoming credits (counterparty is not
// an account holder — Tesco, Netflix card charge, a salary credit), and
// INTERNAL transfers whose label matched no budget category (savings, a move
// paid as a pair, any un-labeled move). They never affect bankSpentByCategory
// but stay queryable here for the /banco review + a future "ask the couple on
// WhatsApp" flow. `month` ('YYYY-MM') filters on budget_month (which, for an
// unallocated row, equals its booking month — attribution never moves them).
export function listUnallocated(opts: { month?: string } = {}): BankTransactionRow[] {
  const db = ready();
  const conds = ['unallocated = 1'];
  const params: unknown[] = [];
  if (opts.month !== undefined) {
    conds.push('budget_month = ?');
    params.push(opts.month);
  }
  return db
    .prepare(`${TX_SELECT} WHERE ${conds.join(' AND ')} ORDER BY booking_date DESC`)
    .all(...params) as unknown as BankTransactionRow[];
}

// Bulk-apply the month-attribution pass: budget_month + move_reason, and —
// only when a transaction was moved to a different month — re-point category_id
// to that month's same-named category id (category ids are per-month UUIDs, so
// the moved spend must carry the TARGET month's id to surface under it in
// bankSpentByCategory / the UI). This deliberately bypasses
// setTransactionCategory's booking-month guard: attribution is authoritative
// and the target category is known to exist (it has a plan for that month).
// One transaction for atomicity.
// True when `categoryId` provably belongs to a month OTHER than `budgetMonth`
// (budgetMonth's category list exists and does not contain it). Lenient like
// categoryKnownWrongForTransaction: an unresolvable budgetMonth returns false
// (don't touch) rather than guessing.
function categoryIsForOtherMonth(categoryId: string, budgetMonth: string): boolean {
  const m = budgetMonth.match(/^(\d{4})-(\d{2})$/);
  if (!m) return false;
  const month = getMonthByYM(Number(m[1]), Number(m[2]));
  if (!month) return false;
  return !month.categories.some((c) => c.id === categoryId);
}

export function applyMonthAttributions(
  updates: Array<{ id: string; budget_month: string; move_reason: string | null; categoryId?: string }>,
): void {
  if (updates.length === 0) return;
  const db = ready();
  const withCat = db.prepare(
    'UPDATE bank_transactions SET budget_month = ?, move_reason = ?, category_id = ? WHERE id = ?',
  );
  const noCat = db.prepare('UPDATE bank_transactions SET budget_month = ?, move_reason = ? WHERE id = ?');
  // Clearing a stale category_id also resets counted/unallocated to the
  // "unallocated, needs review" state in the SAME update — an uncategorized row
  // must never keep contributing to bankSpentByCategory's counted sum (nice-to-have
  // consistency fix; category_id=NULL already routes it out of that sum via the
  // `category_id IS NOT NULL` filter, but leaving stale counted/unallocated flags
  // in place would misrepresent it elsewhere, e.g. listUnallocated).
  const noCatClear = db.prepare(
    'UPDATE bank_transactions SET budget_month = ?, move_reason = ?, category_id = NULL, counted = 0, unallocated = 1 WHERE id = ?',
  );
  const readCat = db.prepare('SELECT category_id FROM bank_transactions WHERE id = ?');
  db.exec('BEGIN');
  try {
    for (const u of updates) {
      if (u.categoryId !== undefined) {
        withCat.run(u.budget_month, u.move_reason, u.categoryId, u.id);
        continue;
      }
      // No target-month category id supplied. Leaving the row's EXISTING
      // category_id in place is safe only when it belongs to `budget_month`;
      // category ids are per-month UUIDs, so if the row is now landing in a
      // DIFFERENT month, that stale id matches no category in budget_month AND
      // its old month no longer holds it — the row would drop out of category
      // spend silently. Detect the mismatch, warn, and null the id so the next
      // attribution run routes the row to the review queue instead of losing it.
      const existing = readCat.get(u.id) as { category_id: string | null } | undefined;
      if (existing?.category_id && categoryIsForOtherMonth(existing.category_id, u.budget_month)) {
        console.warn(
          '[bank] month attribution would leave a stale category_id in a different month than budget_month — clearing it and routing to review',
          { id: u.id, budget_month: u.budget_month, stale_category_id: existing.category_id },
        );
        noCatClear.run(u.budget_month, u.move_reason, u.id);
      } else {
        noCat.run(u.budget_month, u.move_reason, u.id);
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
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

const JOINT_ACCOUNT_UIDS_KEY = 'joint_account_uids';

// The Enable Banking UID(s) of the JOINT account — the ONLY account whose rows
// count toward category spend (the joint-only signed-net model; see
// bankSpentByCategory + attribution.ts). Stored as a JSON string array; an
// unset/corrupt value yields [] (the model then attributes no spend and warns,
// rather than falling back to counting personal-account rows).
export function getJointAccountUids(): string[] {
  const raw = getSetting(JOINT_ACCOUNT_UIDS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string' && x.length > 0);
  } catch {
    // corrupt setting — treat as unset (attribute no spend; callers warn)
  }
  return [];
}

export function setJointAccountUids(uids: string[]): void {
  setSetting(
    JOINT_ACCOUNT_UIDS_KEY,
    JSON.stringify(uids.filter((x) => typeof x === 'string' && x.length > 0)),
  );
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

// ----- bank-label semantics (shared by categorize.ts + attribution.ts) -----
//
// One place owns "what a labeled transfer's core label is" and "whose money is
// this" — categorize.ts (label -> budget-category match) and attribution.ts
// (transfer-leg de-dup + internal/external gate) MUST agree, and used to drift:
// two copies of the normalizer stripped person tags differently, so
// "Pay later El To RAFAEL" (person tag in the MIDDLE) reduced to "pay later el"
// on one side and "pay later" on the other — the legs never paired and the
// allocation was dropped. Keeping it here, imported by both, makes that
// impossible.

// The couple's account-holder name tokens — the whole reason a transfer is
// "internal" (their own money moving between their two accounts) and the tokens
// stripped from a labeled transfer so its core label is the budget line. Their
// real names: "Rafael Petriccone" / "Rafaela François" / the joint
// "RAFAEL DOS SANTOS PETRICCONE & RAFAELA MACIEL VAROLO FRANCOIS". Overridable
// via the `account_holder_tokens` setting (getAccountHolderTokens) — this is
// the default when it's unset.
export const DEFAULT_HOLDER_TOKENS: readonly string[] = [
  'rafael',
  'rafaela',
  'petriccone',
  'dos',
  'santos',
  'maciel',
  'varolo',
  'francois',
];

const ACCOUNT_HOLDER_TOKENS_KEY = 'account_holder_tokens';

// Directional transfer markers + the "El"/"Ela" (ele/ela) person tags Rafa
// appends to a labeled transfer. Fixed; the holder-name tokens are configurable.
const DIRECTIONAL_TAGS = ['to', 'from'];
const PERSON_TAGS = ['el', 'ela'];

// Case/accent fold, the shared primitive under everything below.
function normalizeBasic(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

// A single comparable token: fold + drop anything non-alphanumeric ("François"
// -> "francois").
function normalizeToken(t: string): string {
  return normalizeBasic(t).replace(/[^a-z0-9]+/g, '');
}

// Turn a raw description/counterparty into a comparable budget label: fold,
// punctuation -> spaces, then remove EVERY directional marker (to/from), person
// tag (el/ela), and account-holder name token (rafael, dos, santos, ...)
// WHEREVER it occurs (not just trailing), and collapse spaces. So
// "Pay later El To RAFAEL" -> "pay later", "Shop To RAFAEL DOS SANTOS" ->
// "shop", "Netflix To RAFAELA MACIEL" -> "netflix". A labeled transfer thus
// reduces to exactly its budget line whether the person tag is leading,
// trailing, or in the middle. A label that is ONLY markers/tags (e.g.
// "From RAFAELA") reduces to "" — a pure move, matching no category.
export function normalizeLabel(raw: string, holderTokens: readonly string[] = DEFAULT_HOLDER_TOKENS): string {
  const strip = new Set([...DIRECTIONAL_TAGS, ...PERSON_TAGS, ...holderTokens.map(normalizeToken)]);
  return normalizeBasic(raw)
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !strip.has(w))
    .join(' ')
    .trim();
}

// ----- internal-transfer classification (full account-holder NAMES) -----
//
// Distinct from the label tokens above: those STRIP name fragments off a label;
// these decide whether a row is the couple moving their OWN money (INTERNAL) —
// a candidate budget allocation — versus an external merchant/person. Getting
// this wrong is the money bug: a false internal double-counts (or, on a credit,
// hides) real spend. So classification matches the couple's FULL name as a
// CONTIGUOUS phrase, never single tokens — the joint account name is "RAFAEL
// DOS SANTOS PETRICCONE …", and single-token matching wrongly flagged a
// merchant literally named e.g. "Shop Dos Santos" as internal.

// The couple's full account-holder names, both the short (first + last) and the
// long (with middle names) forms that show up as a Revolut counterparty.
// Overridable via the `account_holder_names` setting (getAccountHolderNames).
export const DEFAULT_HOLDER_NAMES: readonly string[] = [
  'Rafael Petriccone',
  'Rafael dos Santos Petriccone',
  'Rafaela François',
  'Rafaela Maciel Varolo François',
];

const ACCOUNT_HOLDER_NAMES_KEY = 'account_holder_names';

// Bare account-label self-transfer descriptors (matched as the WHOLE, exact
// normalized counterparty — not a substring — so a merchant like "Personal
// Trainer" is NOT misread as a "Personal" self-transfer). PT + EN forms.
const SELF_TRANSFER_LABELS = new Set([
  'joint',
  'personal',
  'joint account',
  'personal account',
  'conjunta',
  'pessoal',
  'conta conjunta',
  'conta pessoal',
]);

// Fold + lowercase + non-alphanumeric → single space + trim. Used for full-name
// phrase matching on both the counterparty and the configured holder names, so
// "Rafaela François" and "RAFAELA-FRANCOIS" compare equal.
function normalizeName(s: string): string {
  return normalizeBasic(s)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// A self-transfer arrow is a SHAPE, not any stray "->"/"→" in free text: the
// WHOLE normalized string must be "<account> <arrow> <account>", each side one
// of the couple's OWN account labels. Anchoring it this way stops a payer whose
// memo merely contains "->" (e.g. an inbound credit described "Shop ->
// reembolso") from classifying INTERNAL and — as a CRDT — silently subtracting
// from a category with no knowledge of the couple (security HIGH-A).
const SELF_TRANSFER_ARROW = /^(joint|personal|conjunta|pessoal)\s*(→|->)\s*(joint|personal|conjunta|pessoal)$/i;

function isSelfTransferArrow(s: string): boolean {
  return SELF_TRANSFER_ARROW.test(s.trim());
}

// Fold a name/counterparty into comparable word tokens ("Rafaela François" ->
// ['rafaela', 'francois']).
function nameTokens(s: string): string[] {
  return normalizeName(s).split(/\s+/).filter(Boolean);
}

function sameTokenSeq(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((t, i) => t === b[i]);
}

// Is this row the couple moving their OWN money (INTERNAL)? True when:
//   1. it's a self-transfer between their own accounts — an account→account
//      arrow SHAPE ("Joint → Personal", in the counterparty OR description, but
//      ONLY when the OTHER field is empty — see the field-split-spoof note
//      below; a bare "->" anywhere in free text does NOT qualify), or the
//      counterparty is a bare account label ("Joint"/"Personal"/"Conjunta"/
//      "Pessoal"); or
//   2. the counterparty OR description IS a couple member's FULL name — matched
//      as the WHOLE token sequence (word-sequence), not a padded substring, so a
//      DIFFERENT person whose name merely extends a holder name ("Rafael
//      Petriccone Neto" vs "Rafael Petriccone") is not misread as internal, and
//      a holder name buried in a longer payer-supplied memo can't spoof it (MED-3).
// Everything else — a merchant charge, an external person's credit — is EXTERNAL
// and never counts toward (nor subtracts from) a category.
export function isInternalTransfer(
  row: { counterparty: string | null; description?: string | null },
  holderNames: readonly string[] = DEFAULT_HOLDER_NAMES,
): boolean {
  const counterparty = row.counterparty ?? '';
  const description = row.description ?? '';

  // 1. Self-transfer descriptors. The arrow SHAPE is trusted as an internal
  //    signal ONLY when the OTHER field is empty/whitespace-only — categorize.ts's
  //    matchLabel reads description and counterparty INDEPENDENTLY, so without
  //    this guard a spoofed "Joint -> Personal" placed in one field could pair
  //    with a real category name sitting in the OTHER field (payer-controlled),
  //    wrongly classifying an external row internal and letting it count toward
  //    (or, as a CRDT, subtract from) that category (security MEDIUM,
  //    field-split arrow spoof). A genuine self-transfer's arrow lives alone in
  //    its own field.
  if (isSelfTransferArrow(counterparty) && description.trim() === '') return true;
  if (isSelfTransferArrow(description) && counterparty.trim() === '') return true;
  if (SELF_TRANSFER_LABELS.has(normalizeName(counterparty))) return true;

  // 2. A full holder NAME as the WHOLE token sequence of either field.
  const names = holderNames.map(nameTokens).filter((n) => n.length > 0);
  if (names.length === 0) return false;
  const cp = nameTokens(counterparty);
  const desc = nameTokens(description);
  return names.some((n) => sameTokenSeq(n, cp) || sameTokenSeq(n, desc));
}

// The configured full holder names, or DEFAULT_HOLDER_NAMES when the
// `account_holder_names` setting is unset/empty/corrupt. Stored as a JSON string
// array; can be seeded from the linked accounts' holder names later.
export function getAccountHolderNames(): string[] {
  const raw = getSetting(ACCOUNT_HOLDER_NAMES_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const names = parsed.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
        if (names.length) return names;
      }
    } catch {
      // corrupt setting — fall back to the default name list
    }
  }
  return [...DEFAULT_HOLDER_NAMES];
}

export function setAccountHolderNames(names: string[]): void {
  const cleaned = names.filter((x) => typeof x === 'string' && x.trim().length > 0);
  setSetting(ACCOUNT_HOLDER_NAMES_KEY, JSON.stringify(cleaned));
}

// The configured account-holder tokens (normalized), or DEFAULT_HOLDER_TOKENS
// when the `account_holder_tokens` setting is unset/empty/corrupt. Stored as a
// JSON array; can be derived from the linked accounts' holder names when that
// data becomes available (setAccountHolderTokens).
export function getAccountHolderTokens(): string[] {
  const raw = getSetting(ACCOUNT_HOLDER_TOKENS_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const tokens = parsed
          .filter((x): x is string => typeof x === 'string')
          .map(normalizeToken)
          .filter(Boolean);
        if (tokens.length) return tokens;
      }
    } catch {
      // corrupt setting — fall back to the default token list
    }
  }
  return [...DEFAULT_HOLDER_TOKENS];
}

export function setAccountHolderTokens(tokens: string[]): void {
  const normalized = tokens.map(normalizeToken).filter(Boolean);
  setSetting(ACCOUNT_HOLDER_TOKENS_KEY, JSON.stringify(normalized));
}

// ----- counterparty → category rules -----
//
// Explicit, human-authored exceptions to the allocation-only model: an
// EXTERNAL counterparty (e.g. "Clúid Housing Association" — the landlord) whose
// charge IS the expense itself, because no labeled transfer fronts it. A rule
// maps a counterparty to a budget category NAME; categorize.ts assigns it as a
// fallback when label matching fails, and attribution.ts's allocation gate
// treats a rule-matched, categorized joint row as spend. Everything else about
// the model (joint-only scope, signed net, CRDT netting guard, payday
// roll-forward) applies unchanged.
//
// These are NOT generic merchant-keyword rules (that principle is unchanged —
// a Tesco charge still never counts as Shop). Each rule names one exact
// counterparty the couple explicitly decided counts as a category's spend.

export interface BankCategoryRuleLike {
  // Which transaction field the pattern matches. Only 'counterparty' exists
  // today; optional so tests can pass the minimal { pattern, category_name }.
  match_field?: string;
  // Stored PRE-NORMALIZED with the shared normalizeLabel (accent/case fold,
  // punctuation → space, transfer/person/holder tokens stripped).
  pattern: string;
  // The budget category NAME this counterparty's charges belong to. Category
  // ids are per-month UUIDs, so callers resolve the name against a specific
  // month's categories (same resolution the label path uses).
  category_name: string;
}

export interface BankCategoryRuleRow extends BankCategoryRuleLike {
  id: string;
  match_field: string;
  created_at: string;
}

const RULES_SELECT =
  'SELECT id, match_field, pattern, category_name, created_at FROM bank_category_rules';

// Insert a rule. The pattern is NORMALIZED with the shared normalizeLabel
// before storing, so lookups compare like-for-like no matter how the
// counterparty's case/accents arrive from the ASPSP feed.
export function addBankCategoryRule(input: {
  pattern: string;
  category_name: string;
  match_field?: string;
}): BankCategoryRuleRow {
  const db = ready();
  const normalized = normalizeLabel(input.pattern);
  if (!normalized) throw new Error('bank: category rule pattern normalizes to empty');
  if (normalized.length < 3) throw new Error('bank: category rule pattern too short after normalization (min 3 chars)');
  if (!input.category_name.trim()) throw new Error('bank: category rule needs a category_name');
  const id = crypto.randomUUID();
  const matchField = input.match_field?.trim() || 'counterparty';
  db.prepare(
    'INSERT INTO bank_category_rules (id, match_field, pattern, category_name, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, matchField, normalized, input.category_name.trim(), new Date().toISOString());
  return db.prepare(`${RULES_SELECT} WHERE id = ?`).get(id) as BankCategoryRuleRow;
}

// Newest first, so a duplicate-pattern rule added later wins in
// matchBankCategoryRule's first-hit scan.
export function listBankCategoryRules(): BankCategoryRuleRow[] {
  const db = ready();
  return db.prepare(`${RULES_SELECT} ORDER BY created_at DESC`).all() as unknown as BankCategoryRuleRow[];
}

export function removeBankCategoryRule(id: string): void {
  const db = ready();
  db.prepare('DELETE FROM bank_category_rules WHERE id = ?').run(id);
}

// The rule-match helper shared by categorize.ts (assign) and attribution.ts
// (allocation gate): normalize the counterparty with the SAME shared
// normalizer used to store patterns, then compare EXACT-equality against each
// rule's stored pattern. Exact — never substring/fuzzy — so a similarly-named
// merchant ("Clúid Housing Association Gift Shop") never rides a rule.
// `rules` may be pre-supplied (avoids a DB read per row in bulk passes, and
// keeps the pure categorize tests DB-free); default loads from the store.
export function matchBankCategoryRule(
  counterparty: string | null,
  opts: { holderTokens?: readonly string[]; rules?: readonly BankCategoryRuleLike[] } = {},
): BankCategoryRuleLike | null {
  if (!counterparty) return null;
  const normalized = normalizeLabel(counterparty, opts.holderTokens ?? DEFAULT_HOLDER_TOKENS);
  if (!normalized) return null;
  const rules = opts.rules ?? listBankCategoryRules();
  for (const r of rules) {
    if ((r.match_field || 'counterparty') !== 'counterparty') continue;
    if (r.pattern === normalized) return r;
  }
  return null;
}

// ----- review questions (wave 2e, intel layer) -----
//
// Per-transaction question rows posted to the couple's WhatsApp when the
// auto-categorizer (LLM, label match, rule) couldn't confidently assign a
// budget category: confidence < 0.9 OR category_id IS NULL AND the row is
// unallocated. One row per tx (UNIQUE on tx_id) — answered / expired rows
// short-circuit so re-running ask never spams a question that's already in
// flight, and a stale pending row is revived (asked_at refreshed) so a
// re-prompt can be sent on the next run.

export interface ReviewQuestionRow {
  id: string;
  tx_id: string;
  tx_date: string | null;
  tx_description: string | null;
  tx_amount: number | null;
  asked_at: string;
  status: 'pending' | 'answered' | 'expired';
  answered_by: 'rafa' | 'rafaela' | null;
  answered_at: string | null;
  chosen_category_id: string | null;
  answer_text: string | null;
}

const REVIEW_QUESTION_TTL_MS = 24 * 60 * 60 * 1000; // 24h

const REVIEW_SELECT = `
  SELECT id, tx_id, tx_date, tx_description, tx_amount, asked_at, status,
         answered_by, answered_at, chosen_category_id, answer_text
  FROM bank_review_questions
`;

// Result of an upsert into bank_review_questions for one tx_id. `null` means
// there's already an ANSWERED row — the caller should NOT re-ask. `sent=true`
// means the caller SHOULD send a WhatsApp message (new row inserted, OR an
// expired row revived with a fresh asked_at); `sent=false` means an existing
// pending row was reused and no new message is needed.
export interface ReviewQuestionCreateResult {
  row: ReviewQuestionRow;
  sent: boolean;
}

export function createReviewQuestion(input: {
  tx_id: string;
  tx_date: string | null;
  tx_description: string | null;
  tx_amount: number | null;
}): ReviewQuestionCreateResult | null {
  const db = ready();
  const existing = db.prepare(`${REVIEW_SELECT} WHERE tx_id = ?`).get(input.tx_id) as
    | ReviewQuestionRow
    | undefined;
  const now = new Date().toISOString();

  if (existing) {
    if (existing.status === 'answered') return null;
    if (existing.status === 'pending') {
      return { row: existing, sent: false };
    }
    // expired -> revive with fresh asked_at, treat as a new prompt
    db.prepare('UPDATE bank_review_questions SET asked_at = ?, status = ? WHERE id = ?').run(
      now,
      'pending',
      existing.id,
    );
    const revived = db.prepare(`${REVIEW_SELECT} WHERE id = ?`).get(existing.id) as ReviewQuestionRow;
    return { row: revived, sent: true };
  }

  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO bank_review_questions
       (id, tx_id, tx_date, tx_description, tx_amount, asked_at, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
  ).run(id, input.tx_id, input.tx_date, input.tx_description, input.tx_amount, now);
  const row = db.prepare(`${REVIEW_SELECT} WHERE id = ?`).get(id) as ReviewQuestionRow;
  return { row, sent: true };
}

export function getReviewQuestionById(id: string): ReviewQuestionRow | null {
  const db = ready();
  const r = db.prepare(`${REVIEW_SELECT} WHERE id = ?`).get(id) as ReviewQuestionRow | undefined;
  return r ?? null;
}

export function listPendingReviewQuestions(limit: number): ReviewQuestionRow[] {
  const db = ready();
  return db
    .prepare(`${REVIEW_SELECT} WHERE status = 'pending' ORDER BY asked_at ASC LIMIT ?`)
    .all(limit) as unknown as ReviewQuestionRow[];
}

// Atomic first-writer-wins: a pending row's UPDATE only succeeds when its
// status is still 'pending'. Returns true iff exactly one row was updated —
// false means somebody else already claimed it (or it never was / isn't
// pending anymore). The route layer maps false -> 409.
export function claimReviewQuestion(
  id: string,
  by: 'rafa' | 'rafaela',
  answerText: string | null,
  categoryId: string | null,
): boolean {
  const db = ready();
  const now = new Date().toISOString();
  const res = db
    .prepare(
      `UPDATE bank_review_questions
       SET status = 'answered', answered_by = ?, answered_at = ?,
           chosen_category_id = ?, answer_text = ?
       WHERE id = ? AND status = 'pending'`,
    )
    .run(by, now, categoryId, answerText, id);
  return ((res as { changes?: number }).changes ?? 0) === 1;
}

// Sweep pending rows older than the TTL to 'expired' so the next ask can
// revive-and-re-prompt instead of silently leaving them hanging. Returns the
// number of rows expired (for logs / counters).
export function expireStaleReviewQuestions(): number {
  const db = ready();
  const cutoff = new Date(Date.now() - REVIEW_QUESTION_TTL_MS).toISOString();
  const res = db
    .prepare(
      `UPDATE bank_review_questions SET status = 'expired'
       WHERE status = 'pending' AND asked_at < ?`,
    )
    .run(cutoff);
  return ((res as { changes?: number }).changes ?? 0);
}

// Candidates for the WhatsApp ask sweep: unallocated rows where the
// auto-categorizer either didn't pick a category (category_id IS NULL) or
// picked one but with confidence below the auto-accept threshold (<0.9).
// Scoped to the supplied 'YYYY-MM' list (current + previous 3). Ordered newest
// booking_date first so the freshest ambiguity gets asked first; the caller
// caps the result.
export function listAskCandidates(monthKeys: string[], limit: number): BankTransactionRow[] {
  const db = ready();
  const conds: string[] = [
    'unallocated = 1',
    "((category_id IS NOT NULL AND (confidence IS NULL OR confidence < 0.9)) OR category_id IS NULL)",
  ];
  const params: unknown[] = [];
  if (monthKeys.length > 0) {
    conds.push(`(${monthKeys.map(() => 'booking_date LIKE ?').join(' OR ')})`);
    for (const ym of monthKeys) params.push(`${ym}-%`);
  }
  params.push(limit);
  return db
    .prepare(`${TX_SELECT} WHERE ${conds.join(' AND ')} ORDER BY booking_date DESC, id DESC LIMIT ?`)
    .all(...params) as unknown as BankTransactionRow[];
}
