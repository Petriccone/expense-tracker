import { NextRequest, NextResponse } from 'next/server';
import { finalizeRequisition, findRequisitionByReference } from '@/lib/gocardless';

// GET /api/gocardless/callback?ref=<reference>
// GoCardless redirects the user here after they consent at their bank,
// appending our `reference` as ?ref=. We validate it against the cookie
// (CSRF), fetch + store the linked accounts and their transactions, then
// send the user back to /connections.
export const dynamic = 'force-dynamic';

function currentUserId(): string {
  return process.env.PETRICCO_USER_ID || 'default';
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const ref = url.searchParams.get('ref');
  const error = url.searchParams.get('error');

  if (error) {
    return NextResponse.redirect(new URL(`/connections?error=${encodeURIComponent(error)}`, req.url));
  }
  if (!ref) {
    return NextResponse.redirect(new URL('/connections?error=missing_ref', req.url));
  }

  const refCookie = req.cookies.get('gc_reference')?.value;
  const userId = req.cookies.get('gc_user_id')?.value || currentUserId();
  const requisitionCookie = req.cookies.get('gc_requisition_id')?.value;

  // CSRF guard: if a cookie is present it must match the returned ref. If the
  // cookie was lost (different browser/tab), fall back to resolving the
  // requisition from the stored reference for this (single) user.
  if (refCookie && refCookie !== ref) {
    return NextResponse.redirect(new URL('/connections?error=state_mismatch', req.url));
  }

  try {
    let requisitionId = requisitionCookie;
    if (!requisitionId || refCookie !== ref) {
      const stored = findRequisitionByReference(userId, ref);
      if (!stored) {
        return NextResponse.redirect(new URL('/connections?error=unknown_requisition', req.url));
      }
      requisitionId = stored.requisition_id;
    }

    // Pull accounts + transactions in the background so the redirect stays
    // snappy; if it fails the user can hit "Sync now". Errors are logged.
    finalizeRequisition(requisitionId, userId).catch((err) => {
      console.error('[gocardless] initial finalize failed', err instanceof Error ? err.message : err);
    });

    const res = NextResponse.redirect(new URL('/connections?ok=1', req.url));
    res.cookies.set('gc_reference', '', { path: '/', maxAge: 0 });
    res.cookies.set('gc_requisition_id', '', { path: '/', maxAge: 0 });
    res.cookies.set('gc_user_id', '', { path: '/', maxAge: 0 });
    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown_error';
    return NextResponse.redirect(new URL(`/connections?error=${encodeURIComponent(msg)}`, req.url));
  }
}
