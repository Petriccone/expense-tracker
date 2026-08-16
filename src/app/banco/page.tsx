'use client';

// "Banco" page — Enable Banking (Revolut) connection status + the
// categorization review queue. Talks to /api/banking/* (fixed contract,
// wave 2b). The review queue pools uncategorized transactions across every
// month, so category options for each row's dropdown come from THAT
// transaction's own booking month (fetched via /api/budget/month), not just
// the currently-viewed budget month — a transaction from an older/newer
// month must never be offered a category id that belongs to a different
// month (see docs/2026-08-15-agent-and-bank-automation-design.md, wave 2b
// fix).

import { useCallback, useEffect, useState } from 'react';
import { Landmark } from 'lucide-react';
import { formatMoney, useBudget } from '@/lib/useBudget';
import BankStatusCard from '@/components/banco/BankStatusCard';
import ReviewQueue from '@/components/banco/ReviewQueue';
import type { BankingStatus, BankTransaction } from '@/types/banking';
import type { BudgetCategory } from '@/types/budget';

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let message = `Falha na requisição (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

// null = fetched, and that month has no budget month yet (404) — the row
// shows "crie o mês ... primeiro" instead of a dropdown for it.
type MonthCategoriesMap = Record<string, BudgetCategory[] | null>;

export default function BancoPage() {
  const { settings } = useBudget();
  const currency = settings?.currency ?? 'EUR';
  const formatAmount = useCallback((n: number) => formatMoney(n, currency), [currency]);

  const [status, setStatus] = useState<BankingStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [txLoading, setTxLoading] = useState(true);
  const [txError, setTxError] = useState<string | null>(null);

  const [monthCategories, setMonthCategories] = useState<MonthCategoriesMap>({});

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const data = await fetchJSON<BankingStatus>('/api/banking/status');
      setStatus(data);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Não foi possível carregar o status do banco.');
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const loadTransactions = useCallback(async () => {
    setTxLoading(true);
    setTxError(null);
    try {
      const data = await fetchJSON<BankTransaction[]>('/api/banking/transactions?status=uncategorized');
      setTransactions(data);
    } catch (err) {
      setTxError(err instanceof Error ? err.message : 'Não foi possível carregar a fila de revisão.');
    } finally {
      setTxLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    void loadTransactions();
  }, [loadStatus, loadTransactions]);

  // For every distinct booking month among the queued transactions, fetch
  // THAT month's budget categories (not yet cached) — a 404 (no budget month
  // for it yet) is cached as `null`.
  useEffect(() => {
    const monthYears = Array.from(new Set(transactions.map((tx) => tx.bookingDate.slice(0, 7))));
    const missing = monthYears.filter((ym) => !(ym in monthCategories));
    if (missing.length === 0) return;

    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        missing.map(async (ym) => {
          const [year, month] = ym.split('-').map(Number);
          try {
            const month_ = await fetchJSON<{ categories: BudgetCategory[] }>(
              `/api/budget/month?year=${year}&month=${month}`,
            );
            return [ym, month_.categories] as const;
          } catch {
            return [ym, null] as const;
          }
        }),
      );
      if (cancelled) return;
      setMonthCategories((prev) => {
        const next = { ...prev };
        for (const [ym, categories] of entries) next[ym] = categories;
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [transactions, monthCategories]);

  const handleAssign = useCallback(
    async (id: string, categoryId: string) => {
      await fetchJSON(`/api/banking/transactions/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryId }),
      });
      await loadTransactions();
    },
    [loadTransactions],
  );

  const handleIgnore = useCallback(
    async (id: string) => {
      await fetchJSON(`/api/banking/transactions/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ignored: true }),
      });
      await loadTransactions();
    },
    [loadTransactions],
  );

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold gradient-text flex items-center gap-2">
          <Landmark className="w-7 h-7" style={{ color: '#a78bfa', filter: 'drop-shadow(0 0 6px rgba(124, 58, 237, 0.4))' }} />
          Banco
        </h1>
        <p style={{ color: 'var(--text-secondary)' }}>Conexão com o Revolut e revisão das transações importadas</p>
      </div>

      <BankStatusCard status={status} loading={statusLoading} error={statusError} onRetry={loadStatus} />

      <ReviewQueue
        transactions={transactions}
        loading={txLoading}
        error={txError}
        monthCategories={monthCategories}
        formatAmount={formatAmount}
        onAssign={handleAssign}
        onIgnore={handleIgnore}
        onRetry={loadTransactions}
      />
    </div>
  );
}
