'use client';

// Fila de revisão — uncategorized bank transactions, grouped by their OWN
// booking month (not the currently-viewed budget month — see banco/page.tsx
// for why). Each group's dropdown only offers that group's own month's
// categories; a month with no budget month yet (404 from
// /api/budget/month) shows a prompt instead of a dropdown so a transaction
// can never be mis-assigned a category id from the wrong month. Assigning /
// ignoring PATCHes /api/banking/transactions/:id then the page refetches the
// queue (same refetch-after-mutation pattern as useBudget).

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { monthLabel } from '@/lib/useBudget';
import type { BudgetCategory, BudgetGroup } from '@/types/budget';
import type { BankTransaction } from '@/types/banking';

const GROUPS: { key: BudgetGroup; label: string }[] = [
  { key: 'fixed', label: 'Fixos' },
  { key: 'variable', label: 'Variáveis' },
  { key: 'extra', label: 'Extras' },
];

interface Props {
  transactions: BankTransaction[];
  loading: boolean;
  error: string | null;
  // key 'YYYY-MM'; undefined = not fetched yet, null = no budget month for
  // that YYYY-MM yet (404).
  monthCategories: Record<string, BudgetCategory[] | null>;
  formatAmount: (n: number) => string;
  onAssign: (id: string, categoryId: string) => Promise<void>;
  onIgnore: (id: string) => Promise<void>;
  onRetry: () => void;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function groupByMonth(transactions: BankTransaction[]): Map<string, BankTransaction[]> {
  const groups = new Map<string, BankTransaction[]>();
  for (const tx of transactions) {
    const ym = tx.bookingDate.slice(0, 7);
    const list = groups.get(ym);
    if (list) list.push(tx);
    else groups.set(ym, [tx]);
  }
  return groups;
}

function TxRow({
  tx,
  categories,
  monthLabelText,
  formatAmount,
  onAssign,
  onIgnore,
}: {
  tx: BankTransaction;
  categories: BudgetCategory[] | null | undefined;
  monthLabelText: string;
  formatAmount: (n: number) => string;
  onAssign: Props['onAssign'];
  onIgnore: Props['onIgnore'];
}) {
  const [saving, setSaving] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const categoryId = e.target.value;
    if (!categoryId) return;
    setSaving(true);
    setRowError(null);
    try {
      await onAssign(tx.id, categoryId);
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Não foi possível salvar.');
      setSaving(false);
    }
  };

  const handleIgnore = async () => {
    setSaving(true);
    setRowError(null);
    try {
      await onIgnore(tx.id);
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Não foi possível ignorar.');
      setSaving(false);
    }
  };

  return (
    <div className="py-3 flex items-center gap-3" style={{ borderBottom: '1px solid var(--border-color)' }}>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
          {tx.description}
          {tx.counterparty ? ` · ${tx.counterparty}` : ''}
        </p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {formatDate(tx.bookingDate)}
          {tx.confidence != null ? ` · confiança ${Math.round(tx.confidence * 100)}%` : ''}
        </p>
        {rowError && <p className="text-xs mt-1" style={{ color: '#f87171' }}>{rowError}</p>}
      </div>
      <span
        className="text-sm font-semibold text-right flex-shrink-0"
        style={{ color: tx.amount < 0 ? '#f87171' : '#10B981', minWidth: 90 }}
      >
        {formatAmount(tx.amount)}
      </span>

      {categories === null ? (
        <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-muted)', width: 180 }}>
          crie o mês {monthLabelText} no orçamento primeiro
        </span>
      ) : (
        <select
          className="select-field text-xs flex-shrink-0"
          style={{ width: 180, height: 38 }}
          value={tx.categoryId ?? ''}
          disabled={saving || !categories}
          onChange={(e) => void handleChange(e)}
        >
          <option value="" disabled>{categories ? 'Categorizar…' : 'Carregando…'}</option>
          {(categories ?? []).length > 0 &&
            GROUPS.map(({ key, label }) => {
              const opts = (categories ?? []).filter((c) => c.group === key);
              if (opts.length === 0) return null;
              return (
                <optgroup key={key} label={label}>
                  {opts.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </optgroup>
              );
            })}
        </select>
      )}

      <button
        onClick={() => void handleIgnore()}
        disabled={saving}
        className="text-xs flex-shrink-0"
        style={{ color: 'var(--text-muted)' }}
      >
        ignorar
      </button>
    </div>
  );
}

export default function ReviewQueue({
  transactions,
  loading,
  error,
  monthCategories,
  formatAmount,
  onAssign,
  onIgnore,
  onRetry,
}: Props) {
  const groups = groupByMonth(transactions);

  return (
    <div className="glass-card-static p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Fila de revisão</h2>
        {transactions.length > 0 && (
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {transactions.length} pendente{transactions.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {loading && transactions.length === 0 && !error ? (
        <p className="text-sm py-4" style={{ color: 'var(--text-muted)' }}>Carregando…</p>
      ) : error ? (
        <div className="flex items-center justify-between gap-3 py-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{error}</p>
          </div>
          <button onClick={onRetry} className="btn-secondary text-sm flex-shrink-0">Tentar de novo</button>
        </div>
      ) : transactions.length === 0 ? (
        <p className="text-sm py-4" style={{ color: 'var(--text-muted)' }}>tudo categorizado 🎉</p>
      ) : (
        <div>
          {Array.from(groups.entries()).map(([ym, txs]) => {
            const [year, month] = ym.split('-').map(Number);
            return (
              <div key={ym} className="mb-2">
                <p className="text-xs font-medium mt-3 mb-1" style={{ color: 'var(--text-muted)' }}>
                  {monthLabel(year, month)}
                </p>
                {txs.map((tx) => (
                  <TxRow
                    key={tx.id}
                    tx={tx}
                    categories={monthCategories[ym]}
                    monthLabelText={monthLabel(year, month)}
                    formatAmount={formatAmount}
                    onAssign={onAssign}
                    onIgnore={onIgnore}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
