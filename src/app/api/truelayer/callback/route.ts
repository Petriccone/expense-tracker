import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForToken, syncAll } from '@/lib/truelayer';
import { saveConnection, dbInfo } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const state = url.searchParams.get('state');
  const stateCookie = req.cookies.get('tl_oauth_state')?.value;
  const userId = req.cookies.get('tl_user_id')?.value || 'default';

  if (error) {
    return NextResponse.redirect(
      new URL(`/connections?error=${encodeURIComponent(error)}`, req.url),
    );
  }
  if (!code || !state || state !== stateCookie) {
    return NextResponse.redirect(
      new URL('/connections?error=state_mismatch', req.url),
    );
  }

  const proto = req.headers.get('x-forwarded-proto') || 'http';
  const host = req.headers.get('host') || 'localhost:3000';
  const redirectUri = `${proto}://${host}/api/truelayer/callback`;

  try {
    const token = await exchangeCodeForToken(code, redirectUri);
    saveConnection({
      user_id: userId,
      provider_id: 'uk-revolut',
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_at: Date.now() + token.expires_in * 1000,
    });
    // Kick off an initial sync in the background — keeps the redirect snappy.
    // Don't await; if it fails the user can hit "Sync" from the UI.
    syncAll(userId).catch(err => {
      console.error('[truelayer] initial sync failed', err);
    });
    const res = NextResponse.redirect(new URL('/connections?ok=1', req.url));
    // Clear one-shot state cookie.
    res.cookies.set('tl_oauth_state', '', { path: '/', maxAge: 0 });
    res.cookies.set('tl_user_id', '', { path: '/', maxAge: 0 });
    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown_error';
    return NextResponse.redirect(
      new URL(`/connections?error=${encodeURIComponent(msg)}`, req.url),
    );
  }
}