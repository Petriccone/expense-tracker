// Unit tests for enablebanking.ts. Since there's no real Enable Banking app
// registered yet (needs Rafa's application_id + .pem — see the design doc),
// these cover what can be verified without the live API: JWT signing
// structure, HTTP-mocked client calls, continuation-key pagination, the
// rate-limit error path, and the pure transaction mapping/dedup.

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import {
  signJwt,
  getAspsps,
  startAuth,
  createSession,
  getSession,
  getTransactions,
  mapTransaction,
  mapTransactionBatch,
  transactionDedupId,
  EnableBankingError,
  REVOLUT_IE,
  type EbTransaction,
} from './enablebanking';

let publicKeyPem: string;

beforeAll(() => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  publicKeyPem = publicKey;
  process.env.ENABLE_BANKING_APP_ID = 'test-app-id';
  process.env.ENABLE_BANKING_PRIVATE_KEY = privateKey;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('signJwt', () => {
  it('header carries kid=application_id and alg=RS256', () => {
    const token = signJwt();
    const decoded = jwt.decode(token, { complete: true });
    expect(decoded).not.toBeNull();
    expect(decoded!.header.alg).toBe('RS256');
    expect(decoded!.header.kid).toBe('test-app-id');
  });

  it('claims carry iss/aud and a ~1h expiry, and verify against the public key', () => {
    const token = signJwt();
    const verified = jwt.verify(token, publicKeyPem, { algorithms: ['RS256'] }) as jwt.JwtPayload;
    expect(verified.iss).toBe('enablebanking.com');
    expect(verified.aud).toBe('api.enablebanking.com');
    expect(typeof verified.iat).toBe('number');
    expect(typeof verified.exp).toBe('number');
    expect(verified.exp! - verified.iat!).toBe(3600);
  });

  it('throws a safe, secret-free error when a secret is missing', () => {
    const savedId = process.env.ENABLE_BANKING_APP_ID;
    delete process.env.ENABLE_BANKING_APP_ID;
    try {
      expect(() => signJwt()).toThrow('ENABLE_BANKING_APP_ID is not set');
    } finally {
      process.env.ENABLE_BANKING_APP_ID = savedId;
    }
  });
});

describe('HTTP-mocked client calls', () => {
  it('getAspsps sends a bearer JWT and returns the aspsps array', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ aspsps: [{ name: 'Revolut', country: 'IE' }] }));

    const aspsps = await getAspsps('IE');
    expect(aspsps).toEqual([{ name: 'Revolut', country: 'IE' }]);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.enablebanking.com/aspsps?country=IE');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Bearer /);
    const token = headers.Authorization.replace('Bearer ', '');
    expect(jwt.decode(token, { complete: true })!.header.kid).toBe('test-app-id');
  });

  it('startAuth posts the expected body and returns the auth url', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ url: 'https://bank.example/consent' }));

    const result = await startAuth({
      redirectUrl: 'https://app.example/api/banking/callback',
      validUntil: '2027-01-01T00:00:00Z',
      state: 'state-123',
    });
    expect(result.url).toBe('https://bank.example/consent');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.enablebanking.com/auth');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      access: { valid_until: '2027-01-01T00:00:00Z' },
      aspsp: REVOLUT_IE,
      psu_type: 'personal',
      state: 'state-123',
      redirect_url: 'https://app.example/api/banking/callback',
    });
  });

  it('createSession posts the code and returns session_id + accounts', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ session_id: 'sess-1', accounts: ['acc-1', 'acc-2'] }));

    const session = await createSession('auth-code-xyz');
    expect(session).toEqual({ session_id: 'sess-1', accounts: ['acc-1', 'acc-2'] });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.enablebanking.com/sessions');
    expect(JSON.parse(init.body as string)).toEqual({ code: 'auth-code-xyz' });
  });

  it('getSession reads status + access.valid_until', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        session_id: 'sess-1',
        status: 'AUTHORIZED',
        accounts: ['acc-1'],
        access: { valid_until: '2027-01-01T00:00:00Z' },
      }),
    );

    const status = await getSession('sess-1');
    expect(status.status).toBe('AUTHORIZED');
    expect(status.validUntil).toBe('2027-01-01T00:00:00Z');
  });

  it('throws EnableBankingError with a safe message on a non-2xx response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ error: 'bad_request' }, 400));
    await expect(getAspsps('IE')).rejects.toThrow(EnableBankingError);
  });
});

describe('getTransactions continuation-key pagination', () => {
  it('loops until no continuation_key is returned, concatenating every page', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({
          transactions: [{ transaction_id: 'tx-1' }],
          continuation_key: 'page-2',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          transactions: [{ transaction_id: 'tx-2' }],
        }),
      );

    const result = await getTransactions('acc-1', { dateFrom: '2026-01-01', dateTo: '2026-08-01' });
    expect(result.transactions.map((t) => t.transaction_id)).toEqual(['tx-1', 'tx-2']);
    expect(result.truncated).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const secondUrl = fetchMock.mock.calls[1][0] as string;
    expect(secondUrl).toContain('continuation_key=page-2');
    expect(secondUrl).toContain('date_from=2026-01-01');
  });

  it('stops after a single page when no continuation_key comes back', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ transactions: [{ transaction_id: 'only' }] }));

    const result = await getTransactions('acc-1', {});
    expect(result.transactions).toHaveLength(1);
    expect(result.truncated).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces ASPSP_RATE_LIMIT_EXCEEDED as a distinct error code', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ code: 'ASPSP_RATE_LIMIT_EXCEEDED', message: 'too many requests' }, 429),
    );

    await expect(getTransactions('acc-1', {})).rejects.toMatchObject({
      code: 'ASPSP_RATE_LIMIT_EXCEEDED',
      status: 429,
    });
  });

  it('defensively stops and reports unchanged when continuation_key repeats between pages', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({
          transactions: [{ transaction_id: 'tx-1' }],
          continuation_key: 'stuck-key',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          transactions: [{ transaction_id: 'tx-2' }],
          continuation_key: 'stuck-key',
        }),
      );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await getTransactions('acc-1', {});
    expect(result.transactions.map((t) => t.transaction_id)).toEqual(['tx-1', 'tx-2']);
    expect(result.truncated).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('reports truncated when the page cap is hit with more pages pending', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      const match = url.match(/continuation_key=page-(\d+)/);
      const page = match ? Number.parseInt(match[1], 10) : 0;
      return jsonResponse({
        transactions: [{ transaction_id: `tx-${page}` }],
        continuation_key: `page-${page + 1}`,
      });
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await getTransactions('acc-1', {});
    expect(result.truncated).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe('transactionDedupId + mapTransaction (pure)', () => {
  it('prefers the bank-provided transaction_id when present', () => {
    const t: EbTransaction = { transaction_id: 'tx-abc', status: 'BOOK' };
    expect(transactionDedupId('acc-1', t)).toBe('tx-abc');
  });

  it('falls back to a deterministic hash of account+booking_date+amount+currency+remittance', () => {
    const t: EbTransaction = {
      status: 'BOOK',
      booking_date: '2026-08-01',
      transaction_amount: { amount: '12.50', currency: 'EUR' },
      remittance_information: ['Coffee shop'],
    };
    const id1 = transactionDedupId('acc-1', t);
    const id2 = transactionDedupId('acc-1', { ...t });
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^eb:[0-9a-f]{40}$/);
  });

  it('different inputs produce different fallback ids', () => {
    const a = transactionDedupId('acc-1', {
      status: 'BOOK',
      booking_date: '2026-08-01',
      transaction_amount: { amount: '12.50', currency: 'EUR' },
      remittance_information: ['Coffee shop'],
    });
    const b = transactionDedupId('acc-1', {
      status: 'BOOK',
      booking_date: '2026-08-02',
      transaction_amount: { amount: '12.50', currency: 'EUR' },
      remittance_information: ['Coffee shop'],
    });
    expect(a).not.toBe(b);
  });

  it('folds the account into the fallback hash so two accounts never collide (cross-account dedup)', () => {
    const same = {
      status: 'BOOK' as const,
      booking_date: '2026-08-01',
      transaction_amount: { amount: '12.50', currency: 'EUR' },
      remittance_information: ['Coffee shop'],
    };
    const idAccountA = transactionDedupId('acc-a', same);
    const idAccountB = transactionDedupId('acc-b', same);
    expect(idAccountA).not.toBe(idAccountB);
  });

  it('maps a debit to a negative signed amount and picks up the counterparty (creditor-first)', () => {
    const t: EbTransaction = {
      transaction_id: 'tx-1',
      transaction_amount: { amount: '25.00', currency: 'EUR' },
      credit_debit_indicator: 'DBIT',
      status: 'BOOK',
      booking_date: '2026-08-01',
      remittance_information: ['Groceries'],
      creditor: { name: 'Tesco' },
      debtor: { name: 'Rafa' },
    };
    const mapped = mapTransaction('acc-1', t);
    expect(mapped).not.toBeNull();
    expect(mapped!.id).toBe('tx-1');
    expect(mapped!.account_uid).toBe('acc-1');
    expect(mapped!.amount).toBe(-25);
    expect(mapped!.currency).toBe('EUR');
    expect(mapped!.credit_debit).toBe('DBIT');
    expect(mapped!.counterparty).toBe('Tesco');
    expect(mapped!.description).toBe('Groceries');
    expect(mapped!.status).toBe('BOOK');
  });

  it('maps a credit to a positive signed amount and picks up the counterparty (debtor-first)', () => {
    const t: EbTransaction = {
      transaction_id: 'tx-2',
      transaction_amount: { amount: '100.00', currency: 'EUR' },
      credit_debit_indicator: 'CRDT',
      status: 'BOOK',
      creditor: { name: 'Rafa' },
      debtor: { name: 'Employer Ltd' },
    };
    const mapped = mapTransaction('acc-1', t);
    expect(mapped).not.toBeNull();
    expect(mapped!.amount).toBe(100);
    expect(mapped!.counterparty).toBe('Employer Ltd');
  });

  it('falls back to the other party name when the direction-preferred one is empty', () => {
    const debit: EbTransaction = {
      transaction_id: 'tx-3',
      transaction_amount: { amount: '10.00', currency: 'EUR' },
      credit_debit_indicator: 'DBIT',
      status: 'BOOK',
      debtor: { name: 'Rafa' },
    };
    expect(mapTransaction('acc-1', debit)!.counterparty).toBe('Rafa');
  });

  it('skips a transaction with a missing credit_debit_indicator and warns', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t: EbTransaction = {
      transaction_id: 'tx-4',
      transaction_amount: { amount: '10.00', currency: 'EUR' },
      status: 'BOOK',
    };
    expect(mapTransaction('acc-1', t)).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('skips a transaction with an unrecognized credit_debit_indicator and warns', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t = {
      transaction_id: 'tx-5',
      transaction_amount: { amount: '10.00', currency: 'EUR' },
      credit_debit_indicator: 'BOGUS',
      status: 'BOOK',
    } as unknown as EbTransaction;
    expect(mapTransaction('acc-1', t)).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('skips a non-booked (PENDING) row — booked-only model, never stored', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const t: EbTransaction = {
      transaction_id: 'tx-pending',
      transaction_amount: { amount: '5.00', currency: 'EUR' },
      credit_debit_indicator: 'DBIT',
      status: 'PDNG',
    };
    expect(mapTransaction('acc-1', t)).toBeNull();
    expect(debugSpy).toHaveBeenCalled();
  });

  it('skips a row with a missing status the same way as an unrecognized one', () => {
    const t: EbTransaction = {
      transaction_id: 'tx-nostatus',
      transaction_amount: { amount: '5.00', currency: 'EUR' },
      credit_debit_indicator: 'DBIT',
    };
    expect(mapTransaction('acc-1', t)).toBeNull();
  });

  it('booking_date storage uses the same date precedence as the dedup hash (booking_date > value_date > transaction_date)', () => {
    const t: EbTransaction = {
      transaction_id: 'tx-date',
      status: 'BOOK',
      transaction_amount: { amount: '5.00', currency: 'EUR' },
      credit_debit_indicator: 'DBIT',
      value_date: '2026-08-02',
      transaction_date: '2026-08-03',
    };
    expect(mapTransaction('acc-1', t)!.booking_date).toBe('2026-08-02');
  });
});

describe('mapTransactionBatch', () => {
  it('filters out non-booked rows from a batch', () => {
    const booked: EbTransaction = {
      transaction_id: 'tx-1',
      status: 'BOOK',
      transaction_amount: { amount: '5.00', currency: 'EUR' },
      credit_debit_indicator: 'DBIT',
      booking_date: '2026-08-01',
    };
    const pending: EbTransaction = {
      transaction_id: 'tx-2',
      status: 'PDNG',
      transaction_amount: { amount: '5.00', currency: 'EUR' },
      credit_debit_indicator: 'DBIT',
      booking_date: '2026-08-01',
    };
    const mapped = mapTransactionBatch('acc-1', [booked, pending]);
    expect(mapped).toHaveLength(1);
    expect(mapped[0].id).toBe('tx-1');
  });

  it('a booked row re-fetched (present again) maps to the same id — idempotent across overlapping windows', () => {
    const t: EbTransaction = {
      transaction_id: 'tx-repeat',
      status: 'BOOK',
      transaction_amount: { amount: '5.00', currency: 'EUR' },
      credit_debit_indicator: 'DBIT',
      booking_date: '2026-08-01',
    };
    const first = mapTransactionBatch('acc-1', [t]);
    const second = mapTransactionBatch('acc-1', [t]);
    expect(first[0].id).toBe(second[0].id);
  });

  it('disambiguates two identical booked rows with no transaction_id in one batch into two rows', () => {
    const a: EbTransaction = {
      status: 'BOOK',
      transaction_amount: { amount: '5.00', currency: 'EUR' },
      credit_debit_indicator: 'DBIT',
      booking_date: '2026-08-01',
      remittance_information: ['Coffee shop'],
    };
    const b: EbTransaction = { ...a };
    const mapped = mapTransactionBatch('acc-1', [a, b]);
    expect(mapped).toHaveLength(2);
    expect(mapped[0].id).not.toBe(mapped[1].id);
    expect(mapped[1].id).toBe(`${mapped[0].id}#2`);
  });

  it('does not disambiguate rows that carry a real transaction_id, even if otherwise identical', () => {
    const a: EbTransaction = {
      transaction_id: 'tx-real-1',
      status: 'BOOK',
      transaction_amount: { amount: '5.00', currency: 'EUR' },
      credit_debit_indicator: 'DBIT',
      booking_date: '2026-08-01',
    };
    const b: EbTransaction = { ...a, transaction_id: 'tx-real-2' };
    const mapped = mapTransactionBatch('acc-1', [a, b]);
    expect(mapped.map((m) => m.id)).toEqual(['tx-real-1', 'tx-real-2']);
  });

  it('a booked row across two accounts with the same day/amount stays two rows (account-scoped)', () => {
    const same: EbTransaction = {
      status: 'BOOK',
      transaction_amount: { amount: '5.00', currency: 'EUR' },
      credit_debit_indicator: 'DBIT',
      booking_date: '2026-08-01',
      remittance_information: ['Coffee shop'],
    };
    const mappedA = mapTransactionBatch('acc-a', [same]);
    const mappedB = mapTransactionBatch('acc-b', [same]);
    expect(mappedA[0].id).not.toBe(mappedB[0].id);
  });
});
