import type { BankTransactionRow } from '@/lib/bank-store';

// Shared response shape for GET /transactions and PATCH /transactions/[id] —
// camelCases the store's snake_case columns for the UI contract (see
// docs/2026-08-15-agent-and-bank-automation-design.md, wave 2b).
export function toTransactionApiShape(r: BankTransactionRow) {
  return {
    id: r.id,
    bookingDate: r.booking_date,
    amount: r.amount,
    currency: r.currency,
    description: r.description,
    counterparty: r.counterparty,
    categoryId: r.category_id,
    confidence: r.confidence,
  };
}
