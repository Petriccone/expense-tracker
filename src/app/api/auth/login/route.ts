// Access-key login: the one credential a non-technical user can handle.
//
//   GET  /api/auth/login?key=<access-key>&next=/budget   → magic link.
//        Sets the session cookie and redirects; this is the form the
//        WhatsApp agent sends, because it opens straight into the app from
//        the in-app browser with zero typing.
//   POST /api/auth/login {key}                            → typed at /login.
//
// Keys live in ACCESS_KEYS ("name:key,name:key"). Naive per-IP sliding
// window rate limit: keys are 32+ chars of entropy, this only exists to
// blunt scripted guessing (single-container deployment, in-memory is the
// honest scope).
import { NextRequest, NextResponse } from 'next/server';
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  findAccessKey,
  parseAccessKeys,
  signSession,
} from '@/lib/session';

export const dynamic = 'force-dynamic';

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 10;
const attempts = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (attempts.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_ATTEMPTS) {
    attempts.set(ip, recent);
    return true;
  }
  recent.push(now);
  attempts.set(ip, recent);
  return false;
}

function baseUrl(request: NextRequest): string {
  // Behind Traefik (and inside the container) request.url can carry the
  // internal host (0.0.0.0:3000) — rebuild the public origin from the
  // forwarded headers so redirects never leak an internal address.
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? 'localhost';
  const proto = request.headers.get('x-forwarded-proto') ?? (host === 'localhost' ? 'http' : 'https');
  return `${proto}://${host}`;
}

function safeNext(raw: string | null): string {
  // Path-only, same-origin redirect target — never reflect an absolute URL.
  if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return '/budget';
}

function sessionCookie(request: NextRequest): string {
  // Mirror the request scheme behind Traefik (x-forwarded-proto) so Secure
  // cookies are not dropped when the container speaks plain HTTP.
  const proto = request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.replace(':', '');
  const secure = proto === 'https';
  const secret = process.env.SESSION_SECRET ?? '';
  return [
    `${SESSION_COOKIE}=${signSession(secret)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`,
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const key = searchParams.get('key') ?? '';
  const next = safeNext(searchParams.get('next'));

  if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
    console.error('[auth/login] SESSION_SECRET not set — refusing to log anyone in');
    return new NextResponse('auth misconfigured', { status: 500 });
  }

  const name = findAccessKey(key, parseAccessKeys(process.env.ACCESS_KEYS));
  if (!name) {
    const login = new URL('/login', baseUrl(request));
    login.searchParams.set('erro', '1');
    return NextResponse.redirect(login);
  }

  const res = NextResponse.redirect(new URL(next, baseUrl(request)));
  res.headers.set('Set-Cookie', sessionCookie(request));
  console.log(`[auth/login] access key accepted for "${name}"`);
  return res;
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (rateLimited(ip)) {
    return NextResponse.json({ ok: false, error: 'muitas tentativas, tenta de novo em 1 minuto' }, { status: 429 });
  }

  if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
    console.error('[auth/login] SESSION_SECRET not set — refusing to log anyone in');
    return NextResponse.json({ ok: false, error: 'auth não configurado' }, { status: 500 });
  }

  let key = '';
  try {
    const body = (await request.json()) as { key?: unknown };
    key = typeof body.key === 'string' ? body.key : '';
  } catch {
    key = '';
  }

  const name = findAccessKey(key, parseAccessKeys(process.env.ACCESS_KEYS));
  if (!name) {
    return NextResponse.json({ ok: false, error: 'chave inválida' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.headers.set('Set-Cookie', sessionCookie(request));
  console.log(`[auth/login] access key accepted for "${name}"`);
  return res;
}
