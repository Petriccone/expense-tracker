// Enable Banking API client (https://api.enablebanking.com). Covers Revolut
// (IE) — Rafa's joint account. See
// docs/2026-08-15-agent-and-bank-automation-design.md (Phase 2).
//
// Auth: a self-signed RS256 JWT sent as `Authorization: Bearer <jwt>`.
// Header carries `kid = application_id`; claims are `iss=enablebanking.com,
// aud=api.enablebanking.com, iat=now, exp=now+1h`, signed with the app's RSA
// private key. Minted fresh per request (cheap, no network round trip) so
// there's no token-refresh state to manage.
//
// Secrets: ENABLE_BANKING_APP_ID (application_id / JWT kid) and
// ENABLE_BANKING_PRIVATE_KEY (PEM contents). Read via process.env, never
// logged. `required()` throws a message naming the missing var only — never
// its value — so callers (routes) can turn a missing secret into a clean
// 400/500 instead of crashing.
//
// Flow (see the design doc for the full sequence):
//   1. GET  /aspsps?country=IE                    -> list banks
//   2. POST /auth {access,aspsp,psu_type,state,redirect_url} -> {url}
//   3. POST /sessions {code}                       -> {session_id, accounts}
//   4. GET  /sessions/{id}                         -> status + access.valid_until
//   5. GET  /accounts/{account_uid}/transactions    -> transactions + continuation_key (loop)

import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

const BASE = 'https://api.enablebanking.com';
const JWT_TTL_SECONDS = 3600;
// Continuation-key pagination has no documented upper bound; this is a
// sanity cap so a misbehaving API (e.g. echoing the same key forever) can't
// spin the loop indefinitely.
const MAX_TRANSACTION_PAGES = 200;

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export class EnableBankingError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'EnableBankingError';
    this.status = status;
    this.code = code;
  }
}

// ----- Auth -----

// Accept the RSA key whether it's pasted as a real multi-line PEM or as a
// single line with literal "\n" escapes — the latter is the form that
// survives most env-var editors (e.g. Dokploy's KEY=VALUE box). Both
// normalize to a real multi-line PEM for jwt.sign. Pure whitespace/newline
// normalization only — never alters the key material.
function normalizePrivateKey(raw: string): string {
  return raw.replace(/\\n/g, '\n').trim();
}

export function signJwt(): string {
  const appId = required('ENABLE_BANKING_APP_ID');
  const privateKey = normalizePrivateKey(required('ENABLE_BANKING_PRIVATE_KEY'));
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iss: 'enablebanking.com',
      aud: 'api.enablebanking.com',
      iat: now,
      exp: now + JWT_TTL_SECONDS,
    },
    privateKey,
    { algorithm: 'RS256', keyid: appId },
  );
}

// ----- Fetch wrapper -----
// Unlike GoCardless's client (gocardless.ts), which never throws on HTTP
// status so callers can inspect 429 per-account, this one throws on every
// non-2xx — Enable Banking's error shape isn't fully known ahead of the real
// app registration, so centralising the "is this the rate limit?" detection
// here (by scanning the body for the documented code) means every caller
// gets consistent EnableBankingError.code handling for free.
function extractErrorCode(json: unknown): string | undefined {
  if (json && typeof json === 'object') {
    const obj = json as Record<string, unknown>;
    if (typeof obj.code === 'string') return obj.code;
    if (typeof obj.error === 'string') return obj.error;
    if (typeof obj.message === 'string' && obj.message.includes('RATE_LIMIT')) {
      return 'ASPSP_RATE_LIMIT_EXCEEDED';
    }
  }
  return undefined;
}

async function ebFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const token = signJwt();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
  }

  if (!res.ok) {
    const code = extractErrorCode(json);
    const rateLimited = code === 'ASPSP_RATE_LIMIT_EXCEEDED' || res.status === 429;
    throw new EnableBankingError(
      rateLimited
        ? 'Enable Banking rate limit exceeded'
        : `Enable Banking request failed (${res.status})`,
      res.status,
      rateLimited ? 'ASPSP_RATE_LIMIT_EXCEEDED' : code,
    );
  }
  return json;
}

// ----- Aspsps (banks) -----

export interface EbAspsp {
  name: string;
  country: string;
  logo?: string;
}

function asArray(json: unknown, key: string): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object' && Array.isArray((json as Record<string, unknown>)[key])) {
    return (json as Record<string, unknown>)[key] as unknown[];
  }
  return [];
}

export async function getAspsps(country = 'IE'): Promise<EbAspsp[]> {
  const json = await ebFetch(`/aspsps?country=${encodeURIComponent(country)}`);
  return asArray(json, 'aspsps') as EbAspsp[];
}

// ----- Auth (consent) -----

export interface EbAspspRef {
  name: string;
  country: string;
}

// Revolut IE is the only bank wired up in this wave — kept as a parameter
// (not hardcoded into startAuth) so a second bank is just a different call.
export const REVOLUT_IE: EbAspspRef = { name: 'Revolut', country: 'IE' };

export interface StartAuthParams {
  redirectUrl: string;
  validUntil: string; // ISO 8601
  state: string;
  aspsp?: EbAspspRef;
  psuType?: 'personal' | 'business';
}

export async function startAuth(params: StartAuthParams): Promise<{ url: string }> {
  const aspsp = params.aspsp ?? REVOLUT_IE;
  const json = (await ebFetch('/auth', {
    method: 'POST',
    body: JSON.stringify({
      access: { valid_until: params.validUntil },
      aspsp,
      psu_type: params.psuType ?? 'personal',
      state: params.state,
      redirect_url: params.redirectUrl,
    }),
  })) as { url?: string };
  if (!json.url) {
    throw new EnableBankingError('Enable Banking /auth response missing url', 502);
  }
  return { url: json.url };
}

// ----- Sessions -----

export interface EbSession {
  session_id: string;
  accounts: string[];
}

export async function createSession(code: string): Promise<EbSession> {
  const json = (await ebFetch('/sessions', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })) as { session_id?: string; accounts?: Array<string | { uid?: string }> };
  if (!json.session_id) {
    throw new EnableBankingError('Enable Banking /sessions response missing session_id', 502);
  }
  // POST /sessions returns `accounts` as full account OBJECTS (each carrying a
  // `uid`), unlike GET /sessions/{id} which returns bare uid strings. Extract
  // the uid so downstream /accounts/{uid}/transactions calls get a real UUID
  // (passing the whole object stringifies to "[object...]" → EB 422 invalid UUID).
  const accounts = (json.accounts ?? [])
    .map((a) => (typeof a === 'string' ? a : a?.uid))
    .filter((u): u is string => typeof u === 'string' && u.length > 0);
  return { session_id: json.session_id, accounts };
}

export interface EbSessionStatus {
  session_id: string;
  status?: string;
  accounts: string[];
  validUntil?: string;
}

export async function getSession(sessionId: string): Promise<EbSessionStatus> {
  const json = (await ebFetch(`/sessions/${encodeURIComponent(sessionId)}`)) as {
    session_id?: string;
    status?: string;
    accounts?: string[];
    access?: { valid_until?: string };
  };
  return {
    session_id: json.session_id ?? sessionId,
    status: json.status,
    accounts: json.accounts ?? [],
    validUntil: json.access?.valid_until,
  };
}

// ----- Transactions -----

export interface EbTransaction {
  transaction_id?: string;
  entry_reference?: string;
  transaction_amount?: { amount?: string; currency?: string };
  credit_debit_indicator?: 'CRDT' | 'DBIT';
  status?: string;
  booking_date?: string;
  value_date?: string;
  transaction_date?: string;
  remittance_information?: string[];
  creditor?: { name?: string };
  debtor?: { name?: string };
}

export interface GetTransactionsOpts {
  dateFrom?: string;
  dateTo?: string;
  continuationKey?: string;
}

export interface GetTransactionsResult {
  transactions: EbTransaction[];
  // True if MAX_TRANSACTION_PAGES was hit while the API still had more pages
  // pending (continuation_key non-empty) — the caller got a partial result
  // and should surface that rather than silently treating it as complete.
  truncated: boolean;
}

// Loops on `continuation_key` until the API stops returning one, collecting
// every page into a single array — callers never see pagination.
//
// ASSUMPTION (unverified without the live API/consent): the query-param
// names below (date_from/date_to/continuation_key). Also, there may be a
// transaction_status/status filter to request booked-only transactions
// server-side — the exact param name isn't confirmed, so it isn't wired
// here. mapTransaction filters to BOOK-only client-side instead (see below),
// so an unfiltered response is handled correctly either way.
export async function getTransactions(
  accountUid: string,
  opts: GetTransactionsOpts = {},
): Promise<GetTransactionsResult> {
  const out: EbTransaction[] = [];
  let continuationKey = opts.continuationKey;

  for (let page = 0; page < MAX_TRANSACTION_PAGES; page++) {
    const params = new URLSearchParams();
    if (opts.dateFrom) params.set('date_from', opts.dateFrom);
    if (opts.dateTo) params.set('date_to', opts.dateTo);
    if (continuationKey) params.set('continuation_key', continuationKey);
    const qs = params.toString();

    const json = (await ebFetch(
      `/accounts/${encodeURIComponent(accountUid)}/transactions${qs ? `?${qs}` : ''}`,
    )) as { transactions?: EbTransaction[]; continuation_key?: string };

    out.push(...(json.transactions ?? []));
    const nextKey = json.continuation_key;
    if (!nextKey) {
      continuationKey = undefined;
      break;
    }
    if (nextKey === continuationKey) {
      // Defensive: a misbehaving API that echoes the same continuation_key
      // forever would otherwise spin to the page cap every time. Treat an
      // unchanged key as "no more pages" instead.
      console.warn('[enablebanking] continuation_key unchanged between pages, stopping pagination', {
        accountUid,
      });
      continuationKey = undefined;
      break;
    }
    continuationKey = nextKey;
  }

  const truncated = Boolean(continuationKey);
  if (truncated) {
    console.warn('[enablebanking] hit MAX_TRANSACTION_PAGES with more pages pending', {
      accountUid,
      maxPages: MAX_TRANSACTION_PAGES,
    });
  }

  return { transactions: out, truncated };
}

// ----- Mapping (pure, exported for tests) -----

function firstText(...vals: Array<string | undefined | null>): string | null {
  for (const v of vals) {
    if (v && v.trim()) return v.trim();
  }
  return null;
}

// Enable Banking's documented "booked" transaction status (ISO 20022 style).
// Other values (PDNG, INFO, FUTR, CANC, or missing) are treated as not
// confirmed booked. Booked-only model: mapTransaction (below) skips every
// non-booked row before it's ever stored — pending holds are transient and
// not needed for "gasto" tracking, and this sidesteps a whole class of
// reconciliation bugs (a pending row that ages out of the incremental sync's
// date window would otherwise need a delete-and-reinsert dance to stay
// correct; booked-only just never stores it in the first place).
const BOOKED_STATUS = 'BOOK';

// booking_date is the precedence used consistently for both the dedup hash
// below and the stored booking_date in mapTransaction — booked rows always
// carry a booking_date, the value_date/transaction_date fallbacks only
// matter for the rare row missing one.
function bookingDateOf(t: EbTransaction): string | null {
  return firstText(t.booking_date, t.value_date, t.transaction_date);
}

// Prefer the bank-provided transaction_id (or entry_reference) — booked rows
// have a stable one. Falls back to a deterministic hash of
// account+booking_date+amount+currency+remittance so re-fetching the same
// (overlapping) window dedups via INSERT OR IGNORE instead of duplicating
// (the account is folded in so the same day/amount/remittance on two
// different accounts never collides). The hash fallback alone can still
// collide *within* a single fetch batch (e.g. two identical small purchases
// same day/merchant with no bank-provided id) — mapTransactionBatch
// disambiguates that case since it needs batch-wide state; this function
// stays a pure per-row id.
export function transactionDedupId(accountUid: string, t: EbTransaction): string {
  const id = firstText(t.transaction_id, t.entry_reference);
  if (id) return id;
  const date = bookingDateOf(t) ?? '';
  const amount = t.transaction_amount?.amount ?? '';
  const currency = t.transaction_amount?.currency ?? '';
  const remittance = (t.remittance_information ?? []).join(' ');
  const h = crypto
    .createHash('sha1')
    .update(`${accountUid}|${date}|${amount}|${currency}|${remittance}`)
    .digest('hex');
  return `eb:${h}`;
}

export interface MappedTransaction {
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

// Amounts come back unsigned (transaction_amount.amount) with a separate
// credit_debit_indicator — normalise to a signed amount (debit = negative)
// so downstream sums (budget "gasto") don't need to re-derive the sign.
//
// Booked-only: a non-BOOK row (pending/info/future/cancelled/missing status)
// is skipped outright — see the BOOKED_STATUS comment above for why.
//
// credit_debit_indicator is validated rather than defaulted: a missing or
// unrecognized value would otherwise silently fall through to "positive"
// (an expense recorded as income), so those rows are skipped instead of
// guessed at.
export function mapTransaction(accountUid: string, t: EbTransaction): MappedTransaction | null {
  if (t.status !== BOOKED_STATUS) {
    console.debug('[enablebanking] skipping non-booked transaction', { accountUid, status: t.status });
    return null;
  }

  const indicator = t.credit_debit_indicator;
  if (indicator !== 'DBIT' && indicator !== 'CRDT') {
    console.warn('[enablebanking] skipping transaction with unrecognized credit_debit_indicator', {
      accountUid,
      id: transactionDedupId(accountUid, t),
    });
    return null;
  }

  const raw = Number.parseFloat(t.transaction_amount?.amount ?? '0');
  const magnitude = Number.isNaN(raw) ? 0 : Math.abs(raw);
  const amount = indicator === 'DBIT' ? -magnitude : magnitude;
  const description =
    firstText((t.remittance_information ?? []).join(' ') || null, t.creditor?.name, t.debtor?.name) ??
    'Transaction';
  // Direction-aware: for a debit the money is going to the creditor, for a
  // credit it's coming from the debtor — prefer that name, falling back to
  // the other side if it's empty.
  const counterparty =
    indicator === 'DBIT'
      ? firstText(t.creditor?.name, t.debtor?.name)
      : firstText(t.debtor?.name, t.creditor?.name);

  return {
    id: transactionDedupId(accountUid, t),
    account_uid: accountUid,
    amount,
    currency: t.transaction_amount?.currency ?? null,
    credit_debit: indicator,
    booking_date: bookingDateOf(t),
    value_date: t.value_date ?? null,
    description,
    counterparty,
    status: t.status ?? null,
  };
}

// Maps a full fetch batch for one account: filters to booked rows (via
// mapTransaction) and disambiguates transactionDedupId's hash-fallback
// colliding *within this batch* — e.g. two identical small purchases same
// day/merchant with no bank-provided id would otherwise hash to the same id
// and collapse into one row (silent money loss). Rows with a real
// transaction_id/entry_reference never need this since the bank guarantees
// their uniqueness.
export function mapTransactionBatch(accountUid: string, transactions: EbTransaction[]): MappedTransaction[] {
  const fallbackOccurrences = new Map<string, number>();
  const out: MappedTransaction[] = [];
  for (const t of transactions) {
    const mapped = mapTransaction(accountUid, t);
    if (!mapped) continue;
    const hasRealId = Boolean(firstText(t.transaction_id, t.entry_reference));
    if (!hasRealId) {
      const seen = fallbackOccurrences.get(mapped.id) ?? 0;
      fallbackOccurrences.set(mapped.id, seen + 1);
      if (seen > 0) mapped.id = `${mapped.id}#${seen + 1}`;
    }
    out.push(mapped);
  }
  return out;
}
