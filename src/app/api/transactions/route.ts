import { NextRequest, NextResponse } from 'next/server';
import { listTransactionsWithAccount, listManualTransactions } from '@/lib/read-store';

// Read API for the app's transaction data (M1 — see
// docs/2026-08-14-m1-real-bank-autosync-design.md). Merges two SQLite
// sources into one list in the app's Transaction shape (id/type/amount/
// description/category/date/createdAt) plus a few bank-specific fields
// (currency/account/transactionType/categoryHint) the UI can use:
//   - truelayer_transactions: real bank data pulled by the TrueLayer sync.
//   - manual_transactions: entries added by hand (Add form, CSV import),
//     so they survive reload instead of living only in localStorage.
// Real categorization is a later milestone — `category` here is a
// best-effort fallback and `categoryHint` carries TrueLayer's raw category
// untouched (manual entries have no hint, category is already final).

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

export interface BankTransaction {
  id: string;
  type: 'income' | 'expense';
  amount: number;
  description: string;
  category: string;
  date: string;
  createdAt: string;
  currency: string | null;
  account: string | null;
  transactionType: string | null;
  categoryHint: string | null;
  source: 'bank' | 'manual';
  notes: string | null;
}

function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

// Accepts either an epoch (ms, digits only) or an ISO date string.
function parseSince(raw: string | null): number | undefined {
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) return Number(raw);
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function parseAccountId(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = parseLimit(searchParams.get('limit'));
    const since = parseSince(searchParams.get('since'));
    const account_id = parseAccountId(searchParams.get('account_id'));

    const rows = listTransactionsWithAccount({ limit, since, account_id });

    const bankTransactions: BankTransaction[] = rows.map((r) => {
      const rawType = r.transaction_type ? r.transaction_type.toUpperCase() : null;
      const type: 'income' | 'expense' =
        rawType === 'CREDIT' ? 'income' : rawType === 'DEBIT' ? 'expense' : r.amount < 0 ? 'expense' : 'income';
      return {
        id: r.transaction_id,
        type,
        amount: Math.abs(r.amount),
        description: r.description || r.raw_description || '(no description)',
        category: r.category || 'Uncategorized',
        date: new Date(r.posted_at).toISOString(),
        createdAt: new Date(r.imported_at).toISOString(),
        currency: r.currency,
        account: r.account_display_name,
        transactionType: r.transaction_type,
        categoryHint: r.category,
        source: 'bank',
        notes: null,
      };
    });

    // Manual entries aren't tied to a bank account, so they only apply when
    // the caller isn't filtering by account_id — listManualTransactions
    // enforces that itself, same as the account_id semantics above.
    const manualRows = listManualTransactions({ limit, since, account_id });
    const manualTransactions: BankTransaction[] = manualRows
      .map((r) => ({
        id: r.id,
        type: r.type === 'income' ? 'income' : 'expense',
        amount: Math.abs(r.amount),
        description: r.description,
        category: r.category,
        date: r.date,
        createdAt: r.created_at,
        currency: null,
        account: null,
        transactionType: null,
        categoryHint: null,
        source: 'manual',
        notes: r.notes,
      }));

    const merged = [...bankTransactions, ...manualTransactions]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, limit);

    return NextResponse.json(merged);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown_error';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
