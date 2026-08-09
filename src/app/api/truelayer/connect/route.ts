import { NextRequest, NextResponse } from 'next/server';
import { buildAuthUrl } from '@/lib/truelayer';
import crypto from 'node:crypto';

// Single-user app for now — use a stable id derived from the install. When
// real auth lands, replace with req.cookies.get('session_id') or similar.
function currentUserId(): string {
  return process.env.PETRICCO_USER_ID || 'default';
}

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // State param guards against CSRF. Stored in a short-lived cookie the
  // callback will validate. (For multi-user we'd key by session.)
  const state = crypto.randomBytes(16).toString('hex');
  const proto = req.headers.get('x-forwarded-proto') || 'http';
  const host = req.headers.get('host') || 'localhost:3000';
  const redirectUri = `${proto}://${host}/api/truelayer/callback`;

  const url = buildAuthUrl(state, redirectUri);

  const res = NextResponse.redirect(url);
  res.cookies.set('tl_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: proto === 'https',
    maxAge: 600,
    path: '/',
  });
  res.cookies.set('tl_user_id', currentUserId(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: proto === 'https',
    maxAge: 600,
    path: '/',
  });
  return res;
}