'use client';

// Income block: salaries + extras, inline-editable, "+ renda".

import { useState } from 'react';
import { Landmark, PiggyBank, Plus, Trash2, Wallet, X } from 'lucide-react';
import InlineMoneyEdit from './InlineMoneyEdit';
import InlineTextEdit from './InlineTextEdit';
import type { BudgetIncome, IncomeKind } from '@/types/budget';

interface Props {
  incomes: BudgetIncome[];
  formatAmount: (n: number) => string;
  accountBalance: number;
  onUpdateIncome: (id: string, patch: { label?: string; amount?: number }) => Promise<void>;
  onDeleteIncome: (id: string) => Promise<void>;
  onAddIncome: (input: { label: string; amount: number; kind: IncomeKind }) => Promise<void>;
}

export default function IncomeBlock({ incomes, formatAmount, accountBalance, onUpdateIncome, onDeleteIncome, onAddIncome }: Props) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [kind, setKind] = useState<IncomeKind>('salary');

  const salaries = incomes.filter((i) => i.kind === 'salary');
  const extras = incomes.filter((i) => i.kind === 'extra');

  const submitAdd = async () => {
    const trimmed = label.trim();
    const n = parseFloat(amount);
    if (!trimmed || !Number.isFinite(n) || n < 0) return;
    try {
      await onAddIncome({ label: trimmed, amount: n, kind });
      setLabel('');
      setAmount('');
      setKind('salary');
      setAdding(false);
    } catch {
      // error surfaced via the page-level banner
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remover esta renda?')) return;
    try {
      await onDeleteIncome(id);
    } catch {
      // error surfaced via the page-level banner
    }
  };

  const renderRow = (income: BudgetIncome) => (
    <div key={income.id} className="flex items-center gap-3 py-2 group" style={{ borderBottom: '1px solid var(--border-color)' }}>
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{
          background: income.kind === 'salary' ? 'rgba(16, 185, 129, 0.12)' : 'rgba(6, 182, 212, 0.12)',
          boxShadow: income.kind === 'salary' ? '0 0 10px rgba(16, 185, 129, 0.14)' : '0 0 10px rgba(6, 182, 212, 0.14)',
        }}
      >
        {income.kind === 'salary' ? (
          <Landmark className="w-4 h-4 text-green-400" />
        ) : (
          <Wallet className="w-4 h-4" style={{ color: '#22d3ee' }} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <InlineTextEdit
          value={income.label}
          onSave={(v) => onUpdateIncome(income.id, { label: v })}
          className="text-sm font-medium"
          style={{ color: 'var(--text-primary)' }}
        />
      </div>
      <InlineMoneyEdit
        value={income.amount}
        onSave={(v) => onUpdateIncome(income.id, { amount: v })}
        formatAmount={formatAmount}
        valueClassName="text-sm font-semibold"
        valueStyle={{ color: 'var(--text-primary)' }}
      />
      <button
        onClick={() => handleDelete(income.id)}
        className="opacity-0 group-hover:opacity-100 p-1 rounded-lg transition-opacity"
        style={{ color: 'var(--text-muted)' }}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );

  return (
    <div className="glass-card-static p-5">
      <h2 className="text-base font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Renda</h2>

      {salaries.length > 0 && (
        <div className="mb-1">
          <p className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Salários</p>
          {salaries.map(renderRow)}
        </div>
      )}

      {extras.length > 0 && (
        <div className="mt-3">
          <p className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Extras</p>
          {extras.map(renderRow)}
        </div>
      )}

      {incomes.length === 0 && (
        <p className="text-sm py-2" style={{ color: 'var(--text-muted)' }}>Nenhuma renda cadastrada ainda.</p>
      )}

      {adding ? (
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <input
            type="text"
            placeholder="Nome"
            value={label}
            autoFocus
            onChange={(e) => setLabel(e.target.value)}
            className="flex-1 min-w-[100px] px-2 py-1.5 text-sm rounded-lg"
            style={{ background: 'var(--bg-input)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)', outline: 'none' }}
          />
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="Valor"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitAdd();
              if (e.key === 'Escape') setAdding(false);
            }}
            className="w-24 px-2 py-1.5 text-sm rounded-lg"
            style={{ background: 'var(--bg-input)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)', outline: 'none' }}
          />
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as IncomeKind)}
            className="select-field"
            style={{ width: 104, height: 34, padding: '0 8px', fontSize: 13 }}
          >
            <option value="salary">Salário</option>
            <option value="extra">Extra</option>
          </select>
          <button
            onClick={() => void submitAdd()}
            className="p-1.5 text-green-400 rounded-lg transition-colors"
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(16, 185, 129, 0.1)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            onClick={() => setAdding(false)}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover-bg)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="mt-3 text-xs font-medium flex items-center gap-1"
          style={{ color: '#a78bfa' }}
        >
          <Plus className="w-3.5 h-3.5" /> renda
        </button>
      )}

      {/* Saldo em Conta — mesmo lugar da planilha (junto da Renda):
          linha "Last Month" (saldo extra, editável no grupo Extras) +
          o que ainda falta gastar do planejado. */}
      <div className="divider-glow mt-4 mb-4" />
      <div className="flex items-center gap-2">
        <PiggyBank className="w-4 h-4" style={{ color: '#22d3ee', filter: 'drop-shadow(0 0 6px rgba(6, 182, 212, 0.4))' }} />
        <div>
          <p
            className="text-xs uppercase tracking-wide"
            style={{ color: 'var(--text-muted)' }}
            title="Linha &quot;Last Month&quot; (saldo extra do mês passado) + o que ainda falta gastar do planejado"
          >
            Saldo em Conta
          </p>
          <p className="text-xl font-bold" style={{ color: '#22d3ee' }}>{formatAmount(accountBalance)}</p>
        </div>
      </div>
    </div>
  );
}
