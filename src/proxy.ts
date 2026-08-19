// App-level auth gate (Next 16 `proxy` file convention — middleware renamed).
//
// Public:  /login, /api/auth/login, /api/ping, /api/health, /privacy, /terms,
//          static assets. Ping/health must stay open: they are Dokploy's
//          health checks and are already designed as unauthenticated probes.
// /api/*:  HTTP Basic (agents) OR session cookie (browser) OR x-cron-secret
//          (machine routes, which also self-check it) — else 401 JSON.
// Pages:   session cookie — else redirect to /login?next=<path>.
//
// Fail-closed like src/lib/api-auth.ts: in production, if auth env is not
// configured we refuse to serve protected paths rather than open the app.
import { NextResponse, type NextRequest } from 'next/server';
import {
  SESSION_COOKIE,
  checkBasicAuth,
  checkCronSecret,
  verifySession,
} from '@/lib/session';

const PUBLIC_PAGES = new Set(['/', '/login', '/privacy', '/terms']);
const PUBLIC_API = new Set(['/api/auth/login', '/api/ping', '/api/health']);

function isPublic(pathname: string): boolean {
  if (PUBLIC_PAGES.has(pathname) || PUBLIC_API.has(pathname)) return true;
  // _next assets, favicon, manifest etc. — matcher already excludes the
  // noisy prefixes; keep a defensive check here for root-level files.
  if (/^\/[^/]*\.(?:ico|png|svg|txt|webmanifest|xml)$/.test(pathname)) return true;
  return false;
}

function unauthorizedApi(): NextResponse {
  // No WWW-Authenticate on purpose: the WhatsApp in-app browser (the whole
  // reason this exists) renders the native basic-auth prompt as a blank
  // page. Clients that speak Basic send it unprompted.
  return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
}

function failClosed(reason: string): NextResponse {
  console.error(`[proxy] fail-closed: ${reason}`);
  return new NextResponse('auth misconfigured', { status: 500 });
}

export default async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const isProd = process.env.NODE_ENV === 'production';
  const secret = process.env.SESSION_SECRET;
  const user = process.env.EXPENSE_TRACKER_USER;
  const pass = process.env.EXPENSE_TRACKER_PASS;
  const cronSecret = process.env.INTERNAL_API_SECRET;

  if (isProd && (!secret || !user || !pass)) {
    return failClosed(
      `missing ${[!secret && 'SESSION_SECRET', !user && 'EXPENSE_TRACKER_USER', !pass && 'EXPENSE_TRACKER_PASS']
        .filter(Boolean)
        .join(', ')} — refusing to serve unauthenticated`,
    );
  }

  // Dev convenience, same posture as api-auth.ts: with no auth env at all,
  // non-production serves without a gate so local/sandbox work is not
  // blocked on secrets that only exist on the VM.
  if (!isProd && !secret && !user && !pass) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get(SESSION_COOKIE)?.value;
  const cookieOk = secret ? verifySession(cookie, secret) : false;
  const basicOk = checkBasicAuth(request.headers.get('authorization'), user, pass);
  const cronOk = checkCronSecret(request.headers.get('x-cron-secret'), cronSecret);

  if (pathname.startsWith('/api/')) {
    if (basicOk || cookieOk || cronOk) return NextResponse.next();
    return unauthorizedApi();
  }

  if (cookieOk) return NextResponse.next();

  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? 'localhost';
  const proto = request.headers.get('x-forwarded-proto') ?? 'https';
  const login = new URL('/login', `${proto}://${host}`);
  // Only same-origin, path-only `next` — never reflect arbitrary URLs.
  if (pathname.startsWith('/') && !pathname.startsWith('//')) {
    login.searchParams.set('next', pathname + search);
  }
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
  ],
};
