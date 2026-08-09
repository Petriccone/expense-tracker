// Server-side SQLite via Node 22's built-in `node:sqlite` (experimental).
// Lives at /data on Dokploy (mounted as a volume) or ./data locally.
// In serverless/edge runtimes this would not work — but Dokploy runs the
// Next.js server in a long-lived container, so a file-backed DB is fine.

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

function resolveDataDir(): string {
  if (process.env.PETRICCO_DATA_DIR) return process.env.PETRICCO_DATA_DIR;
  if (process.env.NODE_ENV === 'production') return '/data';
  return path.join(process.cwd(), 'data');
}

function dbPath(): string {
  const dir = resolveDataDir();
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'expense-tracker.db');
}

function encryptionKey(): Buffer {
  const secret = process.env.TRUELAYER_CLIENT_SECRET || 'fallback-key-do-not-use';
  return crypto.createHash('sha256').update(secret).digest();
}

function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ct].map(b => b.toString('base64')).join('.');
}

function decrypt(payload: string): string {
  const [ivB64, tagB64, ctB64] = payload.split('.');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

let _db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (_db) return _db;
  const path = dbPath();
  _db = new DatabaseSync(path);
  _db.exec('PRAGMA journal_mode = WAL;');
  _db.exec('PRAGMA foreign_keys = ON;');
  migrate(_db);
  return _db;
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS truelayer_connections (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         TEXT NOT NULL,
      provider_id     TEXT NOT NULL,
      access_token    TEXT NOT NULL,
      refresh_token   TEXT NOT NULL,
      expires_at      INTEGER NOT NULL,
      created_at      INTEGER NOT NULL,
      UNIQUE(user_id, provider_id)
    );

    CREATE TABLE IF NOT EXISTS truelayer_accounts (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_id   INTEGER NOT NULL REFERENCES truelayer_connections(id) ON DELETE CASCADE,
      truelayer_id     TEXT NOT NULL UNIQUE,
      display_name    TEXT,
      account_type    TEXT,
      currency        TEXT,
      balance         REAL
    );

    CREATE TABLE IF NOT EXISTS truelayer_transactions (
      id              TEXT PRIMARY KEY,
      account_id      INTEGER NOT NULL REFERENCES truelayer_accounts(id) ON DELETE CASCADE,
      amount          REAL NOT NULL,
      currency        TEXT,
      description     TEXT NOT NULL,
      raw_description TEXT,
      posted_at       INTEGER NOT NULL,
      transaction_type TEXT,
      categorised     INTEGER DEFAULT 0,
      imported_at     INTEGER NOT NULL,
      category        TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_truelayer_tx_posted ON truelayer_transactions(posted_at);
    CREATE INDEX IF NOT EXISTS idx_truelayer_tx_account ON truelayer_transactions(account_id);
  `);
}

// node:sqlite uses positional placeholders (?), not named.
// Helpers below unwrap statement results so route handlers can keep their
// row-shape code untouched from the better-sqlite3 era.

function toRow(stmt: { all(...a: unknown[]): unknown[] }, args: unknown[] = []): unknown[][] {
  return stmt.all(...args) as unknown[][];
}

export interface TruelayerConnection {
  id: number;
  user_id: string;
  provider_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  created_at: number;
}

export interface TruelayerAccount {
  id: number;
  truelayer_id: string;
  display_name: string | null;
  account_type: string | null;
  currency: string | null;
  balance: number | null;
}

export interface TruelayerTransaction {
  id: string;
  account_id: number;
  amount: number;
  currency: string | null;
  description: string;
  raw_description: string | null;
  posted_at: number;
  transaction_type: string | null;
  categorised: number;
  imported_at: number;
  category: string | null;
}

// node:sqlite returns positionally-indexed arrays. We type them as readonly
// tuples for clarity at the call sites, then unwrap into named records.

function rowToConnection(r: ReadonlyArray<unknown>): TruelayerConnection {
  return {
    id: r[0] as number,
    user_id: r[1] as string,
    provider_id: r[2] as string,
    access_token: r[3] as string,
    refresh_token: r[4] as string,
    expires_at: r[5] as number,
    created_at: r[6] as number,
  };
}
function rowToAccount(r: ReadonlyArray<unknown>): TruelayerAccount {
  return {
    id: r[0] as number,
    truelayer_id: r[1] as string,
    display_name: r[2] as string | null,
    account_type: r[3] as string | null,
    currency: r[4] as string | null,
    balance: r[5] as number | null,
  };
}
function rowToTransaction(r: ReadonlyArray<unknown>): TruelayerTransaction {
  return {
    id: r[0] as string,
    account_id: r[1] as number,
    amount: r[2] as number,
    currency: r[3] as string | null,
    description: r[4] as string,
    raw_description: r[5] as string | null,
    posted_at: r[6] as number,
    transaction_type: r[7] as string | null,
    categorised: r[8] as number,
    imported_at: r[9] as number,
    category: r[10] as string | null,
  };
}

export function saveConnection(input: {
  user_id: string;
  provider_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: number;
}): TruelayerConnection {
  const db = getDb();
  // Upsert via INSERT ... ON CONFLICT (sqlite supports it).
  db.prepare(`
    INSERT INTO truelayer_connections
      (user_id, provider_id, access_token, refresh_token, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, provider_id) DO UPDATE SET
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expires_at = excluded.expires_at
  `).run(
    input.user_id,
    input.provider_id,
    encrypt(input.access_token),
    encrypt(input.refresh_token),
    input.expires_at,
    Date.now(),
  );
  const rows = toRow(db.prepare(
    'SELECT id, user_id, provider_id, access_token, refresh_token, expires_at, created_at FROM truelayer_connections WHERE user_id = ? AND provider_id = ?'
  ), [input.user_id, input.provider_id]);
  return rowToConnection(rows[0]);
}

export function getConnection(user_id: string, provider_id: string): TruelayerConnection | null {
  const db = getDb();
  const rows = toRow(db.prepare(
    'SELECT id, user_id, provider_id, access_token, refresh_token, expires_at, created_at FROM truelayer_connections WHERE user_id = ? AND provider_id = ?'
  ), [user_id, provider_id]);
  if (!rows[0]) return null;
  const r = rowToConnection(rows[0]);
  return { ...r, access_token: decrypt(r.access_token), refresh_token: decrypt(r.refresh_token) };
}

export function upsertAccount(input: {
  connection_id: number;
  truelayer_id: string;
  display_name: string | null;
  account_type: string | null;
  currency: string | null;
  balance: number | null;
}): TruelayerAccount {
  const db = getDb();
  db.prepare(`
    INSERT INTO truelayer_accounts
      (connection_id, truelayer_id, display_name, account_type, currency, balance)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(truelayer_id) DO UPDATE SET
      display_name = excluded.display_name,
      account_type = excluded.account_type,
      currency = excluded.currency,
      balance = excluded.balance
  `).run(
    input.connection_id,
    input.truelayer_id,
    input.display_name,
    input.account_type,
    input.currency,
    input.balance,
  );
  const rows = toRow(db.prepare(
    'SELECT id, connection_id, truelayer_id, display_name, account_type, currency, balance FROM truelayer_accounts WHERE truelayer_id = ?'
  ), [input.truelayer_id]);
  return rowToAccount(rows[0]);
}

export function listAccounts(connection_id: number): TruelayerAccount[] {
  const db = getDb();
  return toRow(db.prepare(
    'SELECT id, connection_id, truelayer_id, display_name, account_type, currency, balance FROM truelayer_accounts WHERE connection_id = ?'
  ), [connection_id]).map(rowToAccount);
}

export function upsertTransactions(rows: TruelayerTransaction[]): {
  inserted: number;
  duplicates: number;
} {
  if (rows.length === 0) return { inserted: 0, duplicates: 0 };
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO truelayer_transactions
      (id, account_id, amount, currency, description, raw_description,
       posted_at, transaction_type, categorised, imported_at, category)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let inserted = 0;
  const now = Date.now();
  for (const r of rows) {
    const res = stmt.run(
      r.id,
      r.account_id,
      r.amount,
      r.currency,
      r.description,
      r.raw_description,
      r.posted_at,
      r.transaction_type,
      r.categorised,
      now,
      r.category,
    );
    if ((res as { changes?: number }).changes && (res as { changes?: number }).changes! > 0) {
      inserted++;
    }
  }
  return { inserted, duplicates: rows.length - inserted };
}

export function listTransactions(opts: {
  limit?: number;
  since?: number;
  category?: string;
} = {}): TruelayerTransaction[] {
  const db = getDb();
  const conds: string[] = [];
  const params: unknown[] = [];
  if (opts.since !== undefined) {
    conds.push('posted_at >= ?');
    params.push(opts.since);
  }
  if (opts.category) {
    conds.push('category = ?');
    params.push(opts.category);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const limit = opts.limit ?? 500;
  params.push(limit);
  return toRow(db.prepare(
    `SELECT id, account_id, amount, currency, description, raw_description, posted_at, transaction_type, categorised, imported_at, category FROM truelayer_transactions ${where} ORDER BY posted_at DESC LIMIT ?`
  ), params).map(rowToTransaction);
}

export function dbInfo(): { path: string; size: number; tables: string[] } {
  const db = getDb();
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all().map((r: unknown) => (r as Record<string, unknown>).name as string);
  const path = dbPath();
  let size = 0;
  try {
    size = fs.statSync(path).size;
  } catch {
    // file may not exist on first run
  }
  return { path, size, tables };
}