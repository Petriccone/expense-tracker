import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SESSION_TTL_SECONDS,
  checkBasicAuth,
  checkCronSecret,
  findAccessKey,
  parseAccessKeys,
  signSession,
  verifySession,
} from './session';

const SECRET = 'test-secret-test-secret-test-secret';

describe('parseAccessKeys', () => {
  it('parses name:key pairs and ignores malformed entries', () => {
    const keys = parseAccessKeys('rafaela:abcdefghijklmnop, rafa:qrstuvwxyz123456, broken, :nope, x:short');
    expect(keys.size).toBe(2);
    expect(keys.get('abcdefghijklmnop')).toBe('rafaela');
    expect(keys.get('qrstuvwxyz123456')).toBe('rafa');
  });

  it('returns empty map for missing env', () => {
    expect(parseAccessKeys(undefined).size).toBe(0);
    expect(parseAccessKeys('').size).toBe(0);
  });

  it('keeps colons inside the key (name split on the FIRST colon only)', () => {
    const keys = parseAccessKeys('rafaela:abc:defghijklmnop');
    expect(keys.get('abc:defghijklmnop')).toBe('rafaela');
  });
});

describe('findAccessKey', () => {
  it('matches a configured key and returns its name', () => {
    const keys = parseAccessKeys('rafaela:abcdefghijklmnop');
    expect(findAccessKey('abcdefghijklmnop', keys)).toBe('rafaela');
  });

  it('rejects wrong, empty, and prefix keys', () => {
    const keys = parseAccessKeys('rafaela:abcdefghijklmnop');
    expect(findAccessKey('abcdefghijklmnopX', keys)).toBeNull();
    expect(findAccessKey('', keys)).toBeNull();
    expect(findAccessKey('abcdef', keys)).toBeNull();
  });
});

describe('session sign/verify', () => {
  it('round-trips a freshly signed token', () => {
    const token = signSession(SECRET);
    expect(verifySession(token, SECRET)).toBe(true);
  });

  it('rejects expired tokens', () => {
    const token = signSession(SECRET, /* now */ 1000, /* ttl */ 10);
    expect(verifySession(token, SECRET, /* now */ 2000)).toBe(false);
  });

  it('accepts a token exactly at its last valid second', () => {
    const token = signSession(SECRET, 1000, 10);
    expect(verifySession(token, SECRET, 1010)).toBe(true);
  });

  it('rejects tampered payloads and wrong secrets', () => {
    const token = signSession(SECRET);
    const [exp, sig] = token.split('.');
    // Forged expiry (far future) with the original signature.
    expect(verifySession(`${Number(exp) + 99999}.${sig}`, SECRET)).toBe(false);
    expect(verifySession(token, 'another-secret-another-secret')).toBe(false);
  });

  it('rejects malformed tokens without throwing', () => {
    expect(verifySession(undefined, SECRET)).toBe(false);
    expect(verifySession('', SECRET)).toBe(false);
    expect(verifySession('noseparator', SECRET)).toBe(false);
    expect(verifySession('notanumber.sig', SECRET)).toBe(false);
    expect(verifySession('123', SECRET)).toBe(false);
  });

  it('default TTL is the documented 90 days', () => {
    expect(SESSION_TTL_SECONDS).toBe(90 * 24 * 60 * 60);
  });
});

describe('checkBasicAuth', () => {
  const b64 = (s: string) => Buffer.from(s).toString('base64');

  it('accepts the exact pair and rejects everything else', () => {
    const header = `Basic ${b64('rafa:s3cretpass')}`;
    expect(checkBasicAuth(header, 'rafa', 's3cretpass')).toBe(true);
    expect(checkBasicAuth(header, 'rafa', 'wrong')).toBe(false);
    expect(checkBasicAuth(header, 'other', 's3cretpass')).toBe(false);
  });

  it('handles missing header/env and junk input', () => {
    expect(checkBasicAuth(null, 'rafa', 's3cretpass')).toBe(false);
    expect(checkBasicAuth('Basic !!!not-base64!!!', 'rafa', 's3cretpass')).toBe(false);
    expect(checkBasicAuth('Bearer xyz', 'rafa', 's3cretpass')).toBe(false);
    expect(checkBasicAuth(`Basic ${b64('nocolon')}`, 'rafa', 's3cretpass')).toBe(false);
    expect(checkBasicAuth(`Basic ${b64('rafa:s3cretpass')}`, undefined, undefined)).toBe(false);
  });
});

describe('checkCronSecret', () => {
  it('exact match only', () => {
    expect(checkCronSecret('cron-secret-value', 'cron-secret-value')).toBe(true);
    expect(checkCronSecret('cron-secret-valuE', 'cron-secret-value')).toBe(false);
    expect(checkCronSecret(null, 'cron-secret-value')).toBe(false);
    expect(checkCronSecret('cron-secret-value', undefined)).toBe(false);
  });
});

// Clock pinning: verifySession defaults must read a real clock, but the
// explicit-now variants above cover determinism. Unstub defensively anyway.
beforeEach(() => {
  vi.useRealTimers();
});
afterEach(() => {
  vi.restoreAllMocks();
});
