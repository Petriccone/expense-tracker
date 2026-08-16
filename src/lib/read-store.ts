// Read-only queries for the bank read API (GET /api/transactions, /api/accounts).
// Reuses the shared db connection from `./db` — does not open a second one.
//
// Note: node:sqlite's StatementSync.all() returns rows as plain objects keyed
// by column name (verified against the installed Node — NOT positional
// arrays), so these helpers read columns by name.

import { getDb } from './db';

export interface TransactionWithAccountRow {
  transaction_id: string;
  account_id: number;
  amount: number;
  currency: string | null;
  description: string;
  raw_description: string | null;
  posted_at: number;
  transaction_type: string | null;
  category: string | null;
  imported_at: number;
  account_display_name: string | null;
}

export function listTransactionsWithAccount(opts: {
  limit?: number;
  since?: number;
  account_id?: number;
} = {}): TransactionWithAccountRow[] {
  const db = getDb();
  const conds: string[] = [];
  const params: unknown[] = [];
  if (opts.since !== undefined) {
    conds.push('t.posted_at >= ?');
    params.push(opts.since);
  }
  if (opts.account_id !== undefined) {
    conds.push('t.account_id = ?');
    params.push(opts.account_id);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const limit = opts.limit ?? 100;
  params.push(limit);
  const rows = db.prepare(`
    SELECT
      t.id AS transaction_id,
      t.account_id AS account_id,
      t.amount AS amount,
      t.currency AS currency,
      t.description AS description,
      t.raw_description AS raw_description,
      t.posted_at AS posted_at,
      t.transaction_type AS transaction_type,
      t.category AS category,
      t.imported_at AS imported_at,
      a.display_name AS account_display_name
    FROM truelayer_transactions t
    JOIN truelayer_accounts a ON a.id = t.account_id
    ${where}
    ORDER BY t.posted_at DESC
    LIMIT ?
  `).all(...params) as unknown as TransactionWithAccountRow[];
  return rows;
}

export interface AccountRow {
  id: number;
  display_name: string | null;
  account_type: string | null;
  currency: string | null;
  balance: number | null;
}

export function listAllAccounts(): AccountRow[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, display_name, account_type, currency, balance
    FROM truelayer_accounts
    ORDER BY id ASC
  `).all() as unknown as AccountRow[];
  return rows;
}

// ----- Manual transactions -----
// Entries added by hand (Add Transaction form, CSV import) so they persist
// across reload/refresh instead of living only in browser localStorage.
// Same connection as the rest of this file — no second DatabaseSync.

let _manualTableReady = false;

function ensureManualTable(db: ReturnType<typeof getDb>): void {
  if (_manualTableReady) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS manual_transactions (
      id          TEXT PRIMARY KEY,
      type        TEXT NOT NULL,
      amount      REAL NOT NULL,
      description TEXT NOT NULL,
      category    TEXT NOT NULL,
      date        TEXT NOT NULL,
      notes       TEXT,
      created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_manual_tx_date ON manual_transactions(date);
  `);
  _manualTableReady = true;
}

export interface ManualTransactionRow {
  id: string;
  type: string;
  amount: number;
  description: string;
  category: string;
  date: string;
  notes: string | null;
  created_at: string;
}

const MANUAL_COLUMNS = 'id, type, amount, description, category, date, notes, created_at';

export function insertManualTransaction(input: {
  id: string;
  type: string;
  amount: number;
  description: string;
  category: string;
  date: string;
  notes?: string | null;
  created_at: string;
}): ManualTransactionRow {
  const db = getDb();
  ensureManualTable(db);
  db.prepare(`
    INSERT INTO manual_transactions (id, type, amount, description, category, date, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      type = excluded.type,
      amount = excluded.amount,
      description = excluded.description,
      category = excluded.category,
      date = excluded.date,
      notes = excluded.notes
  `).run(
    input.id,
    input.type,
    input.amount,
    input.description,
    input.category,
    input.date,
    input.notes ?? null,
    input.created_at,
  );
  const rows = db.prepare(
    `SELECT ${MANUAL_COLUMNS} FROM manual_transactions WHERE id = ?`
  ).all(input.id) as unknown as ManualTransactionRow[];
  return rows[0];
}

export function listManualTransactions(opts: {
  limit?: number;
  since?: number;
  account_id?: number;
} = {}): ManualTransactionRow[] {
  const db = getDb();
  ensureManualTable(db);
  // Manual entries aren't tied to a bank account — filtering by account_id
  // means "bank rows only", so mirror that here instead of the caller.
  if (opts.account_id !== undefined) return [];
  const conds: string[] = [];
  const params: unknown[] = [];
  if (opts.since !== undefined) {
    // `date` is stored as the app's own YYYY-MM-DD (or ISO) text — a
    // lexicographic comparison against the since boundary's date-only
    // prefix sorts the same as chronological order for that format.
    conds.push('date >= ?');
    params.push(new Date(opts.since).toISOString().slice(0, 10));
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const limit = opts.limit ?? 100;
  params.push(limit);
  const rows = db.prepare(`
    SELECT ${MANUAL_COLUMNS} FROM manual_transactions
    ${where}
    ORDER BY date DESC
    LIMIT ?
  `).all(...params) as unknown as ManualTransactionRow[];
  return rows;
}

export function updateManualTransaction(id: string, patch: {
  type?: string;
  amount?: number;
  description?: string;
  category?: string;
  date?: string;
  notes?: string | null;
}): ManualTransactionRow | null {
  const db = getDb();
  ensureManualTable(db);
  const existingRows = db.prepare(
    `SELECT ${MANUAL_COLUMNS} FROM manual_transactions WHERE id = ?`
  ).all(id) as unknown as ManualTransactionRow[];
  const existing = existingRows[0];
  if (!existing) return null;
  // Assign field-by-field (not `{...existing, ...patch}`) — patch may carry
  // explicit `undefined` for omitted fields, which a spread would still
  // apply and blank out the existing value.
  const merged: ManualTransactionRow = {
    id: existing.id,
    type: patch.type !== undefined ? patch.type : existing.type,
    amount: patch.amount !== undefined ? patch.amount : existing.amount,
    description: patch.description !== undefined ? patch.description : existing.description,
    category: patch.category !== undefined ? patch.category : existing.category,
    date: patch.date !== undefined ? patch.date : existing.date,
    notes: patch.notes !== undefined ? patch.notes : existing.notes,
    created_at: existing.created_at,
  };
  db.prepare(`
    UPDATE manual_transactions
    SET type = ?, amount = ?, description = ?, category = ?, date = ?, notes = ?
    WHERE id = ?
  `).run(merged.type, merged.amount, merged.description, merged.category, merged.date, merged.notes, id);
  return merged;
}

export function deleteManualTransaction(id: string): boolean {
  const db = getDb();
  ensureManualTable(db);
  const res = db.prepare('DELETE FROM manual_transactions WHERE id = ?').run(id);
  return ((res as { changes?: number }).changes ?? 0) > 0;
}
