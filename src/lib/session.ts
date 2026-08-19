// App-level auth for expense-tracker.
//
// Replaces the Traefik/Dokploy basic-auth middleware that used to sit in
// front of the whole app (the native browser popup never renders in the
// WhatsApp in-app browser, so the couple's non-technical user could not
// open the app at all — it just looked like a dead link).
//
// Three credentials are accepted, resolved in `src/proxy.ts`:
//   1. HTTP Basic  (EXPENSE_TRACKER_USER/PASS)   — the WhatsApp agents'
//      `budget` tool keeps sending exactly what it sends today.
//   2. Session cookie (this file)                 — browsers, via an
//      access key exchanged once at /login (or a magic link with ?key=).
//   3. x-cron-secret (INTERNAL_API_SECRET)        — machine routes already
//      enforce it themselves (api-auth.ts); the proxy honors it too so a
//      host-cron caller that never had Traefik basic creds keeps working.
//
// Fail-closed policy mirrors api-auth.ts: in production a missing
// SESSION_SECRET (or missing basic creds when they are required) is a hard
// error, never a silent allow.
import crypto from 'node:crypto';

export const SESSION_COOKIE = 'et_session';
export const SESSION_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

/** Parse `ACCESS_KEYS` ("name:key,name:key") into key -> name. */
export function parseAccessKeys(raw: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!raw) return out;
  for (const entry of raw.split(',')) {
    const idx = entry.indexOf(':');
    if (idx <= 0) continue; // no name, empty name, or empty key
    const name = entry.slice(0, idx).trim();
    const key = entry.slice(idx + 1).trim();
    if (name && key.length >= 16) out.set(key, name);
  }
  return out;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    // Still burn a comparison so timing does not leak length equality.
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

/** Constant-time key lookup (compares against every configured key). */
export function findAccessKey(key: string, keys: Map<string, string>): string | null {
  let match: string | null = null;
  for (const [candidate, name] of keys) {
    if (timingSafeEqualStr(key, candidate)) match = name;
  }
  return match;
}

function hmac(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

/** Mint a session token: `<expiry-epoch>.<hmac>`. */
export function signSession(secret: string, nowSeconds: number = Math.floor(Date.now() / 1000), ttlSeconds: number = SESSION_TTL_SECONDS): string {
  const exp = nowSeconds + ttlSeconds;
  return `${exp}.${hmac(String(exp), secret)}`;
}

/** Verify a session token: right shape, valid signature, not expired. */
export function verifySession(token: string | undefined, secret: string, nowSeconds: number = Math.floor(Date.now() / 1000)): boolean {
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const expStr = token.slice(0, dot);
  if (!/^\d+$/.test(expStr)) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < nowSeconds) return false;
  const expected = hmac(expStr, secret);
  return timingSafeEqualStr(token.slice(dot + 1), expected);
}

/** Validate an `Authorization: Basic ...` header against the app pair. */
export function checkBasicAuth(header: string | null, user: string | undefined, pass: string | undefined): boolean {
  if (!header || !user || !pass) return false;
  const m = /^Basic\s+(.+)$/i.exec(header.trim());
  if (!m) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(m[1], 'base64').toString('utf8');
  } catch {
    return false;
  }
  const idx = decoded.indexOf(':');
  if (idx < 0) return false;
  const okUser = timingSafeEqualStr(decoded.slice(0, idx), user);
  const okPass = timingSafeEqualStr(decoded.slice(idx + 1), pass);
  return okUser && okPass;
}

/** Timing-safe x-cron-secret check (same contract as api-auth.ts). */
export function checkCronSecret(header: string | null, secret: string | undefined): boolean {
  if (!header || !secret) return false;
  return timingSafeEqualStr(header, secret);
}
