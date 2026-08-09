// Thin TrueLayer API client. Two responsibilities:
//   1. Exchange an OAuth auth code for an access token (+ refresh).
//   2. Fetch accounts + transactions from the Data API.
//
// Sandbox vs Live is chosen via TRUELAYER_ENV (defaults to sandbox).

import {
  saveConnection,
  upsertAccount,
  upsertTransactions,
  type TruelayerConnection,
  type TruelayerAccount,
} from './db';

const ENV = process.env.TRUELAYER_ENV === 'live' ? 'live' : 'sandbox';
const BASE = ENV === 'live'
  ? 'https://api.truelayer.com'
  : 'https://api.truelayer-sandbox.com';

const AUTH = ENV === 'live'
  ? 'https://auth.truelayer.com'
  : 'https://auth.truelayer-sandbox.com';

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  token_type: string;
  scope: string;
}

export function buildAuthUrl(state: string, redirectUri: string): string {
  const client_id = required('TRUELAYER_CLIENT_ID');
  // URLSearchParams already percent-encodes each value; don't pre-encode
  // `scope` or spaces become %2520 and TrueLayer rejects the whole request
  // with "Invalid scope" (as we just hit in the live sandbox test).
  const params = new URLSearchParams({
    response_type: 'code',
    client_id,
    redirect_uri: redirectUri,
    scope: 'info accounts balance cards transactions offline_access',
    state,
    providers: 'uk-revolut uk-barclays uk-lloyds uk-monzo uk-starling uk-natwest uk-revolut-business',
  });
  return `${AUTH}/?${params.toString()}`;
}

export async function exchangeCodeForToken(code: string, redirectUri: string): Promise<TokenResponse> {
  const client_id = required('TRUELAYER_CLIENT_ID');
  const client_secret = required('TRUELAYER_CLIENT_SECRET');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id,
    client_secret,
    redirect_uri: redirectUri,
    code,
  });
  const res = await fetch(`${AUTH}/connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new Error(`Token exchange failed (${res.status}): ${await res.text()}`);
  }
  return res.json() as Promise<TokenResponse>;
}

export async function refreshToken(refresh_token: string): Promise<TokenResponse> {
  const client_id = required('TRUELAYER_CLIENT_ID');
  const client_secret = required('TRUELAYER_CLIENT_SECRET');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id,
    client_secret,
    refresh_token,
  });
  const res = await fetch(`${AUTH}/connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new Error(`Token refresh failed (${res.status}): ${await res.text()}`);
  }
  return res.json() as Promise<TokenResponse>;
}

// ----- Data API -----

export interface TLAccount {
  account_id: string;
  display_name: string;
  account_type: string;
  currency: string;
  balance: number | null;
}

export interface TLTransaction {
  transaction_id: string;
  account_id: string;
  amount: number;
  currency: string;
  description: string;
  raw_description: string | null;
  timestamp: string;
  transaction_type: string;
  transaction_category: string | null;
}

async function getValidToken(user_id: string, provider_id: string = 'uk-revolut'): Promise<{
  access_token: string;
}> {
  const conn = await import('./db').then(m => m.getConnection(user_id, provider_id));
  if (!conn) throw new Error('No TrueLayer connection for user');
  // Refresh 60 s early.
  if (conn.expires_at - Date.now() > 60_000) {
    return { access_token: conn.access_token };
  }
  const fresh = await refreshToken(conn.refresh_token);
  saveConnection({
    user_id,
    provider_id,
    access_token: fresh.access_token,
    refresh_token: fresh.refresh_token,
    expires_at: Date.now() + fresh.expires_in * 1000,
  });
  return { access_token: fresh.access_token };
}

export async function fetchAccounts(user_id: string): Promise<TLAccount[]> {
  const { access_token } = await getValidToken(user_id);
  const res = await fetch(`${BASE}/data/v1/accounts`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!res.ok) {
    throw new Error(`Accounts fetch failed (${res.status}): ${await res.text()}`);
  }
  const json = await res.json() as { results: TLAccount[] };
  return json.results;
}

export async function fetchTransactions(
  user_id: string,
  account_id: string,
  since?: string,
): Promise<TLTransaction[]> {
  const { access_token } = await getValidToken(user_id);
  const params = new URLSearchParams({ account_id });
  if (since) params.set('from', since);
  const url = `${BASE}/data/v1/transactions?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!res.ok) {
    throw new Error(`Transactions fetch failed (${res.status}): ${await res.text()}`);
  }
  const json = await res.json() as { results: TLTransaction[] };
  return json.results;
}

// ----- Higher-level sync -----

export interface SyncResult {
  accounts: number;
  transactions: { inserted: number; duplicates: number };
}

export async function syncAll(user_id: string): Promise<SyncResult> {
  // 1. Refresh + save accounts.
  const accounts = await fetchAccounts(user_id);
  for (const a of accounts) {
    upsertAccount({
      connection_id: 0, // filled below by lookup
      truelayer_id: a.account_id,
      display_name: a.display_name,
      account_type: a.account_type,
      currency: a.currency,
      balance: a.balance ?? null,
    });
  }
  // Re-fetch with proper connection_id by re-running the upsert (cheaper: do it inline).
  const conn = (await import('./db')).getConnection(user_id, 'uk-revolut')!;
  for (const a of accounts) {
    upsertAccount({
      connection_id: conn.id,
      truelayer_id: a.account_id,
      display_name: a.display_name,
      account_type: a.account_type,
      currency: a.currency,
      balance: a.balance ?? null,
    });
  }
  // 2. Pull transactions per account.
  const accs = (await import('./db')).listAccounts(conn.id);
  let totalInserted = 0;
  let totalDupes = 0;
  for (const acc of accs) {
    const txs = await fetchTransactions(user_id, acc.truelayer_id);
    const rows = txs.map(t => ({
      id: t.transaction_id,
      account_id: acc.id,
      amount: t.amount,
      currency: t.currency,
      description: t.description,
      raw_description: t.raw_description,
      posted_at: Date.parse(t.timestamp),
      transaction_type: t.transaction_type,
      categorised: 0,
      imported_at: 0, // overwritten by upsertTransactions
      category: t.transaction_category,
    }));
    const { inserted, duplicates } = upsertTransactions(rows as Parameters<typeof upsertTransactions>[0]);
    totalInserted += inserted;
    totalDupes += duplicates;
  }
  return {
    accounts: accounts.length,
    transactions: { inserted: totalInserted, duplicates: totalDupes },
  };
}

// ----- helpers -----

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}