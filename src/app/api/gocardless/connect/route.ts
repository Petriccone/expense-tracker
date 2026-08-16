import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { createRequisition, saveRequisition } from '@/lib/gocardless';

// POST /api/gocardless/connect  { institution_id }
// Creates a GoCardless requisition for the chosen bank, persists it against
// the user, and returns { link } — the browser then navigates to `link` to
// log into the bank and consent. A short-lived cookie carries the reference
// (CSRF guard) for the callback to validate.
export const dynamic = 'force-dynamic';

function currentUserId(): string {
  return process.env.PETRICCO_USER_ID || 'default';
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { institution_id?: string };
    const institutionId = body.institution_id;
    if (!institutionId) {
      return NextResponse.json({ ok: false, error: 'institution_id is required' }, { status: 400 });
    }

    const proto = req.headers.get('x-forwarded-proto') || 'http';
    const host = req.headers.get('host') || 'localhost:3000';
    const redirectUri = `${proto}://${host}/api/gocardless/callback`;

    const reference = crypto.randomBytes(16).toString('hex');
    const requisition = await createRequisition(institutionId, redirectUri, reference);

    saveRequisition({
      user_id: currentUserId(),
      institution_id: institutionId,
      requisition_id: requisition.id,
      reference,
    });

    const res = NextResponse.json({ ok: true, link: requisition.link });
    const secure = proto === 'https';
    res.cookies.set('gc_reference', reference, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      maxAge: 600,
      path: '/',
    });
    res.cookies.set('gc_requisition_id', requisition.id, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      maxAge: 600,
      path: '/',
    });
    res.cookies.set('gc_user_id', currentUserId(), {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      maxAge: 600,
      path: '/',
    });
    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown_error';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
