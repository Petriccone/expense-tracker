// Server-side SQLite client. Stores TrueLayer tokens + cached transactions
// so the user doesn't re-authorize every time. Lives at /data on Dokploy
// (mounted as a persistent volume) or ./data locally.
//
// In serverless/edge runtimes this would not work — but Dokploy runs the
// Next.js server in a long-lived container, so a file-backed SQLite is fine.

import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';

function resolveDataDir(): string {
  // Allow override via env; default to /data in container, ./data locally.
  if (process.env.PETRICCO_DATA_DIR) return process.env.PETRICCO_DATA_DIR;
  if (process.env.NODE_ENV === 'production') return '/data';
  return path.join(process.cwd(), 'data');
}

function dbPath(): string {
  const dir = resolveDataDir();
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'expense-tracker.db');
}

// Encryption helpers — refresh tokens at rest are encrypted with a key
// derived from TRUELAYER_CLIENT_SECRET (good enough to keep them out of a
// casual file dump; not a substitute for a real KMS).
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

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  _db = new Database(dbPath());
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  migrate(_db);
  return _db;
}

function migrate(db: Database.Database): void {
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

// Repository helpers — keep SQL out of the route handlers.

export function saveConnection(input: {
  user_id: string;
  provider_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: number;
}): TruelayerConnection {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO truelayer_connections
      (user_id, provider_id, access_token, refresh_token, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, provider_id) DO UPDATE SET
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expires_at = excluded.expires_at
    RETURNING *
  `);
  return stmt.get(
    input.user_id,
    input.provider_id,
    encrypt(input.access_token),
    encrypt(input.refresh_token),
    input.expires_at,
    Date.now(),
  ) as TruelayerConnection;
}

export function getConnection(user_id: string, provider_id: string): TruelayerConnection | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM truelayer_connections WHERE user_id = ? AND provider_id = ?'
  ).get(user_id, provider_id) as TruelayerConnection | undefined;
  if (!row) return null;
  return {
    ...row,
    access_token: decrypt(row.access_token),
    refresh_token: decrypt(row.refresh_token),
  };
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
  const stmt = db.prepare(`
    INSERT INTO truelayer_accounts
      (connection_id, truelayer_id, display_name, account_type, currency, balance)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(truelayer_id) DO UPDATE SET
      display_name = excluded.display_name,
      account_type = excluded.account_type,
      currency = excluded.currency,
      balance = excluded.balance
    RETURNING *
  `);
  return stmt.get(
    input.connection_id,
    input.truelayer_id,
    input.display_name,
    input.account_type,
    input.currency,
    input.balance,
  ) as TruelayerAccount;
}

export function listAccounts(connection_id: number): TruelayerAccount[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM truelayer_accounts WHERE connection_id = ?'
  ).all(connection_id) as TruelayerAccount[];
}

export function upsertTransactions(rows: Array<TruelayerTransaction>): {
  inserted: number;
  duplicates: number;
} {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO truelayer_transactions
      (id, account_id, amount, currency, description, raw_description,
       posted_at, transaction_type, categorised, imported_at, category)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMany = db.transaction((batch: typeof rows) => {
    let inserted = 0;
    for (const r of batch) {
      const info = stmt.run(
        r.id,
        r.account_id!,
        r.amount,
        r.currency,
        r.description,
        r.raw_description,
        r.posted_at,
        r.transaction_type,
        r.categorised,
        Date.now(),
        r.category,
      );
      if (info.changes > 0) inserted++;
    }
    return inserted;
  });
  const inserted = insertMany(rows);
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
  return db.prepare(
    `SELECT * FROM truelayer_transactions ${where} ORDER BY posted_at DESC LIMIT ?`
  ).all(...params) as TruelayerTransaction[];
}

export function dbInfo(): { path: string; size: number; tables: string[] } {
  const db = getDb();
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all().map((r: any) => r.name);
  const path = dbPath();
  let size = 0;
  try {
    size = fs.statSync(path).size;
  } catch {
    // file may not exist on first run
  }
  return { path, size, tables };
}