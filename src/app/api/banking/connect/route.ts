import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { startAuth, getAspsps, REVOLUT_IE, type EbAspspRef } from '@/lib/enablebanking';
import { setPendingState } from '@/lib/bank-store';
import { ensureBankReady } from '../_ready';

// GET /api/banking/connect — mints a `state`, stores it server-side, starts
// an Enable Banking consent for Revolut (IE), and redirects the browser to
// the bank's own login/consent page. The bank redirects back to
// /api/banking/callback?code=...&state=... once the user consents.
export const dynamic = 'force-dynamic';

// Enable Banking caps the consent window. ASSUMPTION (unverified without a
// live app registration/real consent): Revolut IE's actual max — 180 days
// is the documented ballpark.
const CONSENT_DAYS = 180;

// Look up Revolut's exact {name, country} from the live /aspsps list rather
// than trusting the hardcoded guess — validates the real ASPSP identifier on
// first connect. Falls back to REVOLUT_IE if the lookup fails or doesn't
// find a match, so /connect still works.
async function resolveRevolutAspsp(): Promise<EbAspspRef> {
  try {
    const aspsps = await getAspsps('IE');
    const match = aspsps.find((a) => a.name?.toLowerCase().includes('revolut'));
    if (match) return { name: match.name, country: match.country };
  } catch (err) {
    console.warn(
      '[banking] /aspsps lookup failed, falling back to hardcoded Revolut IE',
      err instanceof Error ? err.message : err,
    );
  }
  return REVOLUT_IE;
}

export async function GET(req: NextRequest) {
  try {
    ensureBankReady();

    const state = crypto.randomUUID();
    setPendingState(state);

    const proto = req.headers.get('x-forwarded-proto') || 'http';
    const host = req.headers.get('host') || 'localhost:3000';
    const redirectUrl = `${proto}://${host}/api/banking/callback`;
    const validUntil = new Date(Date.now() + CONSENT_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const aspsp = await resolveRevolutAspsp();
    const { url } = await startAuth({
      redirectUrl,
      validUntil,
      state,
      aspsp,
    });

    return NextResponse.redirect(url, { status: 302 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown_error';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
