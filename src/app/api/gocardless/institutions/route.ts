import { NextRequest, NextResponse } from 'next/server';
import { listInstitutions } from '@/lib/gocardless';

// GET /api/gocardless/institutions?country=IE
// Powers the bank picker on /connections. Read-only (no bank data), behind
// the app-wide basic-auth at deploy. Defaults to Ireland.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const country = new URL(req.url).searchParams.get('country') || 'IE';
    const institutions = await listInstitutions(country);
    return NextResponse.json(institutions);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown_error';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
