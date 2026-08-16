// GoCardless Bank Account Data API client (formerly Nordigen).
//
// Replaces the old TrueLayer adapter. TrueLayer is a UK entity and can't
// serve Irish banks; GoCardless Bank Account Data covers IE (and all of
// the EEA/UK) and has a free tier.
//
// Docs: https://developer.gocardless.com/bank-account-data/  (base host
// https://bankaccountdata.gocardless.com). Flow:
//   1. POST /api/v2/token/new/  {secret_id, secret_key}
//        -> {access, access_expires, refresh, refresh_expires}
//      (refresh via POST /api/v2/token/refresh/ {refresh} -> {access,...})
//   2. GET  /api/v2/institutions/?country=IE  -> [{id, name, logo, ...}]
//   3. POST /api/v2/requisitions/ {institution_id, redirect, reference}
//        -> {id, link}   (redirect the browser to `link` to consent)
//   4. GET  /api/v2/requisitions/{id}/  -> {accounts:[id...], status}
//   5. GET  /api/v2/accounts/{id}/            (metadata)
//      GET  /api/v2/accounts/{id}/details/    (iban/name/currency/type)
//      GET  /api/v2/accounts/{id}/balances/   (balanceAmount)
//      GET  /api/v2/accounts/{id}/transactions/  -> {transactions:{booked,pending}}
//
// Schema reuse: we keep the existing SQLite tables (truelayer_connections/
// accounts/transactions) unchanged to minimise churn. Per-connection
// GoCardless state is stored in the connections row:
//   provider_id    = institution_id (e.g. "REVOLUT_REVOGB21")
//   access_token   = requisition_id  (encrypted at rest, reusing encrypt())
//   refresh_token  = reference        (the CSRF/lookup token we generated)
//   expires_at     = consent expiry hint (now + ~90d)
// The GoCardless *API* token is global (derived from the env secrets), not
// per-connection, so it lives in an in-memory cache and is re-minted on
// demand — nothing bank-specific about it needs persisting.

import crypto from 'node:crypto';
import {
  saveConnection,
  getConnection,
  upsertAccount,
  upsertTransactions,
  getDb,
  type TruelayerTransaction,
} from './db';

const BASE = 'https://bankaccountdata.gocardless.com/api/v2';

// Default consent window GoCardless grants (their default End User Agreement
// is 90 days of access). Stored only as a "reconnect after this" hint.
const CONSENT_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

// ----- helpers -----

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export interface GCFetchResult {
  ok: boolean;
  status: number;
  json: unknown;
}

// Single place all API calls go through. Never throws on HTTP status (so
// callers can decide how to treat 429 rate-limits per-account); only throws
// on network failure. Never logs secrets or token values.
async function gcFetch(
  path: string,
  init: RequestInit & { auth?: boolean } = {},
): Promise<GCFetchResult> {
  const { auth = true, headers, ...rest } = init;
  const h: Record<string, string> = {
    Accept: 'application/json',
    ...(headers as Record<string, string> | undefined),
  };
  if (auth) h.Authorization = `Bearer ${await getAccessToken()}`;
  if (rest.body && !h['Content-Type']) h['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, { ...rest, headers: h });
  let json: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
  }
  return { ok: res.ok, status: res.status, json };
}

// ----- Auth (global API token, cached in memory) -----

interface TokenNewResponse {
  access?: string;
  access_expires?: number;
  refresh?: string;
  refresh_expires?: number;
}

let _token: { access: string; expires_at: number } | null = null;

export async function getAccessToken(): Promise<string> {
  if (_token && _token.expires_at - Date.now() > 60_000) return _token.access;

  const secret_id = required('GOCARDLESS_SECRET_ID');
  const secret_key = required('GOCARDLESS_SECRET_KEY');

  const res = await gcFetch('/token/new/', {
    auth: false,
    method: 'POST',
    body: JSON.stringify({ secret_id, secret_key }),
  });
  if (!res.ok) {
    throw new Error(`GoCardless token request failed (${res.status})`);
  }
  const body = res.json as TokenNewResponse;

  // /token/new/ returns the access token directly. If a future/edge response
  // ever omitted it but included a refresh token, fall back to /token/refresh/.
  let access = body.access;
  let accessExpires = body.access_expires ?? 86_400; // 24h default
  if (!access && body.refresh) {
    const r = await gcFetch('/token/refresh/', {
      auth: false,
      method: 'POST',
      body: JSON.stringify({ refresh: body.refresh }),
    });
    if (!r.ok) throw new Error(`GoCardless token refresh failed (${r.status})`);
    const rb = r.json as TokenNewResponse;
    access = rb.access;
    accessExpires = rb.access_expires ?? 86_400;
  }
  if (!access) throw new Error('GoCardless token response had no access token');

  _token = { access, expires_at: Date.now() + accessExpires * 1000 };
  return access;
}

// ----- Institutions -----

export interface GCInstitution {
  id: string;
  name: string;
  bic?: string;
  transaction_total_days?: string;
  countries?: string[];
  logo?: string;
}

export async function listInstitutions(country = 'IE'): Promise<GCInstitution[]> {
  const res = await gcFetch(`/institutions/?country=${encodeURIComponent(country)}`);
  if (!res.ok) {
    throw new Error(`GoCardless institutions fetch failed (${res.status})`);
  }
  // The endpoint returns a bare array.
  const arr = Array.isArray(res.json) ? (res.json as GCInstitution[]) : [];
  return arr.map((i) => ({
    id: i.id,
    name: i.name,
    bic: i.bic,
    transaction_total_days: i.transaction_total_days,
    countries: i.countries,
    logo: i.logo,
  }));
}

// ----- Requisitions -----

export interface GCRequisition {
  id: string;
  link: string;
  status?: string;
  reference?: string;
  accounts?: string[];
}

// Create a link the user follows to log into their bank and consent. We pass
// our own `reference` (random) which GoCardless echoes back on the redirect
// as ?ref=<reference> — the callback validates it (CSRF) and uses it/the
// requisition id to finalize.
export async function createRequisition(
  institutionId: string,
  redirectUri: string,
  reference: string,
): Promise<GCRequisition> {
  const res = await gcFetch('/requisitions/', {
    method: 'POST',
    body: JSON.stringify({
      institution_id: institutionId,
      redirect: redirectUri,
      reference,
      user_language: 'EN',
    }),
  });
  if (!res.ok) {
    throw new Error(`GoCardless requisition create failed (${res.status})`);
  }
  const r = res.json as GCRequisition;
  if (!r.id || !r.link) {
    throw new Error('GoCardless requisition response missing id/link');
  }
  return r;
}

export async function getRequisition(requisitionId: string): Promise<GCRequisition & { accounts: string[]; status: string }> {
  const res = await gcFetch(`/requisitions/${encodeURIComponent(requisitionId)}/`);
  if (!res.ok) {
    throw new Error(`GoCardless requisition fetch failed (${res.status})`);
  }
  const r = res.json as GCRequisition;
  return { ...r, accounts: r.accounts ?? [], status: r.status ?? 'UNKNOWN' };
}

// ----- Account data types -----

interface GCAccountDetails {
  account?: {
    iban?: string;
    currency?: string;
    name?: string;
    ownerName?: string;
    cashAccountType?: string;
    product?: string;
  };
}

interface GCBalances {
  balances?: Array<{
    balanceAmount?: { amount?: string; currency?: string };
    balanceType?: string;
    referenceDate?: string;
  }>;
}

interface GCTransaction {
  transactionId?: string;
  internalTransactionId?: string;
  bookingDate?: string;
  bookingDateTime?: string;
  valueDate?: string;
  transactionAmount?: { amount?: string; currency?: string };
  creditorName?: string;
  debtorName?: string;
  remittanceInformationUnstructured?: string;
  remittanceInformationUnstructuredArray?: string[];
  bankTransactionCode?: string;
}

interface GCTransactionsResponse {
  transactions?: {
    booked?: GCTransaction[];
    pending?: GCTransaction[];
  };
}

// ----- Field mapping (pure, exported for tests) -----

function firstText(...vals: Array<string | undefined | null>): string | null {
  for (const v of vals) {
    if (v && v.trim()) return v.trim();
  }
  return null;
}

// Deterministic id for transactions that lack a stable transactionId (common
// for pending, and some booked rows). Same inputs -> same id, so re-syncing
// dedups via INSERT OR IGNORE instead of duplicating.
function synthId(prefix: string, accountRowId: number, t: GCTransaction): string {
  const amount = t.transactionAmount?.amount ?? '';
  const currency = t.transactionAmount?.currency ?? '';
  const date = t.bookingDateTime ?? t.bookingDate ?? t.valueDate ?? '';
  const desc =
    t.remittanceInformationUnstructured ??
    (t.remittanceInformationUnstructuredArray?.join(' ')) ??
    t.creditorName ??
    t.debtorName ??
    '';
  const h = crypto
    .createHash('sha1')
    .update(`${accountRowId}|${date}|${amount}|${currency}|${desc}`)
    .digest('hex');
  return `${prefix}:${accountRowId}:${h}`;
}

export function mapTransaction(
  t: GCTransaction,
  accountRowId: number,
  status: 'booked' | 'pending',
): TruelayerTransaction {
  const remittance =
    t.remittanceInformationUnstructured ??
    (t.remittanceInformationUnstructuredArray?.length
      ? t.remittanceInformationUnstructuredArray.join(' ')
      : null);
  const description =
    firstText(remittance, t.creditorName, t.debtorName) ?? 'Transaction';
  // GoCardless amounts are signed strings (negative = money out).
  const amount = Number.parseFloat(t.transactionAmount?.amount ?? '0');
  const rawDate = t.bookingDateTime ?? t.bookingDate ?? t.valueDate;
  const parsed = rawDate ? Date.parse(rawDate) : NaN;
  const posted_at = Number.isNaN(parsed) ? Date.now() : parsed;
  // Prefer the bank-provided transactionId; fall back to internalTransactionId
  // then a deterministic synthetic id.
  const id =
    (status === 'booked' && firstText(t.transactionId, t.internalTransactionId)) ||
    synthId(status === 'pending' ? 'gcp' : 'gc', accountRowId, t);
  return {
    id,
    account_id: accountRowId,
    amount: Number.isNaN(amount) ? 0 : amount,
    currency: t.transactionAmount?.currency ?? null,
    description,
    raw_description: remittance,
    posted_at,
    transaction_type: status,
    categorised: 0,
    imported_at: 0, // overwritten by upsertTransactions
    category: null, // GoCardless base transactions carry no semantic category
  };
}

// ----- Per-account fetch + upsert -----

async function fetchAccountDetails(accountId: string): Promise<GCAccountDetails['account'] | null> {
  const res = await gcFetch(`/accounts/${encodeURIComponent(accountId)}/details/`);
  if (!res.ok) return null;
  return (res.json as GCAccountDetails).account ?? null;
}

async function fetchAccountMeta(accountId: string): Promise<{ iban?: string; institution_id?: string; currency?: string } | null> {
  const res = await gcFetch(`/accounts/${encodeURIComponent(accountId)}/`);
  if (!res.ok) return null;
  return res.json as { iban?: string; institution_id?: string; currency?: string };
}

async function fetchBalance(accountId: string): Promise<number | null> {
  const res = await gcFetch(`/accounts/${encodeURIComponent(accountId)}/balances/`);
  if (!res.ok) return null; // 429 (rate-limited) or transient — tolerate
  const balances = (res.json as GCBalances).balances ?? [];
  if (balances.length === 0) return null;
  // Prefer an "available" then "booked/closing" balance, else the first.
  const pick =
    balances.find((b) => b.balanceType === 'interimAvailable') ??
    balances.find((b) => b.balanceType === 'closingBooked') ??
    balances.find((b) => b.balanceType === 'expected') ??
    balances[0];
  const amt = Number.parseFloat(pick.balanceAmount?.amount ?? '');
  return Number.isNaN(amt) ? null : amt;
}

export interface SyncResult {
  accounts: number;
  transactions: { inserted: number; duplicates: number };
  rateLimited: boolean;
}

// Fetch every account under a requisition, store account metadata + balances,
// and pull booked + pending transactions into SQLite. Used by both the OAuth
// callback (first link) and the cron/manual sync (re-pull).
async function pullRequisition(
  connectionId: number,
  requisitionId: string,
): Promise<SyncResult> {
  const req = await getRequisition(requisitionId);
  let inserted = 0;
  let duplicates = 0;
  let rateLimited = false;

  for (const accountId of req.accounts) {
    const [details, meta] = await Promise.all([
      fetchAccountDetails(accountId),
      fetchAccountMeta(accountId),
    ]);
    const balance = await fetchBalance(accountId);

    const iban = details?.iban ?? meta?.iban;
    const displayName =
      firstText(
        details?.name,
        details?.ownerName,
        iban ? `Account ••${iban.slice(-4)}` : null,
      ) ?? 'Account';
    const account = upsertAccount({
      connection_id: connectionId,
      truelayer_id: accountId, // column reused for the GoCardless account id
      display_name: displayName,
      account_type: details?.cashAccountType ?? details?.product ?? 'bank',
      currency: details?.currency ?? meta?.currency ?? null,
      balance,
    });

    // Transactions — the rate-limited endpoint on the free tier.
    const txRes = await gcFetch(`/accounts/${encodeURIComponent(accountId)}/transactions/`);
    if (!txRes.ok) {
      // 429 = per-account daily limit hit; skip this account, retry next sync.
      if (txRes.status === 429) rateLimited = true;
      continue;
    }
    const body = txRes.json as GCTransactionsResponse;
    const booked = body.transactions?.booked ?? [];
    const pending = body.transactions?.pending ?? [];

    // Booked rows are permanent — INSERT OR IGNORE dedups on transaction id.
    const bookedRows = booked.map((t) => mapTransaction(t, account.id, 'booked'));
    const bres = upsertTransactions(bookedRows);
    inserted += bres.inserted;
    duplicates += bres.duplicates;

    // Pending rows have no stable id and churn as they clear, so treat them
    // as a fresh snapshot: drop the account's old pending rows, insert the
    // current set. Prevents stale "ghost" pending rows from accumulating.
    const db = getDb();
    db.prepare(
      "DELETE FROM truelayer_transactions WHERE account_id = ? AND transaction_type = 'pending'",
    ).run(account.id);
    const pendingRows = pending.map((t) => mapTransaction(t, account.id, 'pending'));
    const pres = upsertTransactions(pendingRows);
    inserted += pres.inserted;
    duplicates += pres.duplicates;
  }

  return {
    accounts: req.accounts.length,
    transactions: { inserted, duplicates },
    rateLimited,
  };
}

// ----- Connection persistence (reuses the shared tables) -----

function currentUserId(): string {
  return process.env.PETRICCO_USER_ID || 'default';
}

// Save the requisition against the user so the callback + sync can find it.
// provider_id = institution_id, access_token col = requisition_id,
// refresh_token col = reference. saveConnection encrypts both.
export function saveRequisition(input: {
  user_id: string;
  institution_id: string;
  requisition_id: string;
  reference: string;
}): void {
  saveConnection({
    user_id: input.user_id,
    provider_id: input.institution_id,
    access_token: input.requisition_id,
    refresh_token: input.reference,
    expires_at: Date.now() + CONSENT_WINDOW_MS,
  });
}

export interface StoredRequisition {
  connection_id: number;
  institution_id: string;
  requisition_id: string;
  reference: string;
}

// All GoCardless connections for a user (a user may link more than one bank).
export function listStoredRequisitions(user_id: string): StoredRequisition[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT provider_id FROM truelayer_connections WHERE user_id = ? ORDER BY created_at DESC')
    .all(user_id) as Array<{ provider_id: string }>;
  const out: StoredRequisition[] = [];
  for (const { provider_id } of rows) {
    const conn = getConnection(user_id, provider_id);
    if (!conn) continue;
    out.push({
      connection_id: conn.id,
      institution_id: conn.provider_id,
      requisition_id: conn.access_token, // decrypted by getConnection
      reference: conn.refresh_token, // decrypted by getConnection
    });
  }
  return out;
}

export function findRequisitionByReference(user_id: string, reference: string): StoredRequisition | null {
  return listStoredRequisitions(user_id).find((r) => r.reference === reference) ?? null;
}

// ----- Public high-level operations -----

// Called from the callback once the user has consented at their bank. Pulls
// accounts + transactions for the just-linked requisition.
export async function finalizeRequisition(
  requisitionId: string,
  user_id = currentUserId(),
): Promise<SyncResult> {
  const stored = listStoredRequisitions(user_id).find((r) => r.requisition_id === requisitionId);
  if (!stored) throw new Error('No stored connection for that requisition');
  return pullRequisition(stored.connection_id, requisitionId);
}

// Called from cron (/sync) and the manual "Sync now" button (/manual-sync).
// Re-pulls every linked bank for the user. Tolerant of a single account's
// rate-limit: it skips + reports rateLimited so the caller can surface it.
export async function syncAll(user_id = currentUserId()): Promise<SyncResult> {
  const stored = listStoredRequisitions(user_id);
  let accounts = 0;
  let inserted = 0;
  let duplicates = 0;
  let rateLimited = false;
  for (const s of stored) {
    try {
      const r = await pullRequisition(s.connection_id, s.requisition_id);
      accounts += r.accounts;
      inserted += r.transactions.inserted;
      duplicates += r.transactions.duplicates;
      rateLimited = rateLimited || r.rateLimited;
    } catch (err) {
      // Non-fatal: one bank failing (e.g. consent expired) shouldn't abort
      // the others. Logged, retried next interval.
      console.error('[gocardless] sync failed for a connection', err instanceof Error ? err.message : err);
    }
  }
  return { accounts, transactions: { inserted, duplicates }, rateLimited };
}
