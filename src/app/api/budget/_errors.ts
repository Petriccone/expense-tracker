import { NextResponse } from 'next/server';

// budget-store's assert* helpers and not-found/duplicate checks all throw
// plain `Error` with a human-readable message (see budget-store.ts). This is
// the single place that turns those into the right status code for every
// budget route: 404 for "... not found", 409 for "... already exists",
// 400 for everything else (bad numbers, empty strings, invalid enums, ...).
function statusFor(message: string): number {
  if (/not found/i.test(message)) return 404;
  if (/already exists/i.test(message)) return 409;
  return 400;
}

export function budgetErrorResponse(err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : 'unknown_error';
  // Only `budget:`-prefixed messages are our own hand-written, safe-to-show
  // errors (see budget-store.ts). Anything else — e.g. a raw node:sqlite
  // driver error — is unexpected and may leak internals, so wrap it generic.
  if (!message.startsWith('budget:')) {
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
  return NextResponse.json({ error: message }, { status: statusFor(message) });
}
