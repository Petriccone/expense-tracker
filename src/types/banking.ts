// Client-side types for the Enable Banking (Revolut) integration UI —
// mirrors the fixed API contract for /api/banking/* (wave 2b). See
// docs/2026-08-15-agent-and-bank-automation-design.md.

export interface BankingStatus {
  connected: boolean;
  validUntil: string | null;
  lastSync: string | null;
  accountCount: number;
  txCount: number;
}

export interface BankTransaction {
  id: string;
  bookingDate: string;
  amount: number;
  currency: string;
  description: string;
  counterparty: string | null;
  categoryId: string | null;
  confidence: number | null;
}
