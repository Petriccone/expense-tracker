'use client';

// The payoff: Net Worth → Save → Total Saving → Us → El / Ela, 50/50.
// Visually the most prominent card on the page.

import { PiggyBank } from 'lucide-react';
import InlineMoneyEdit from './InlineMoneyEdit';
import type { BudgetMonthRollups } from '@/types/budget';

interface Props {
  rollups: BudgetMonthRollups;
  personALabel: string;
  personBLabel: string;
  formatAmount: (n: number) => string;
  onUpdateSave: (save: number) => Promise<void>;
}

export default function MonthCloseCard({ rollups, personALabel, personBLabel, formatAmount, onUpdateSave }: Props) {
  return (
    <div
      className="glass-card-static p-6 relative overflow-hidden"
      style={{ border: '1px solid rgba(124, 58, 237, 0.25)', boxShadow: '0 0 40px rgba(124, 58, 237, 0.08)' }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'linear-gradient(135deg, rgba(124, 58, 237, 0.07), rgba(6, 182, 212, 0.05))' }}
      />
      <div className="relative">
        <div className="flex items-center gap-2 mb-5">
          <PiggyBank className="w-5 h-5" style={{ color: '#a78bfa', filter: 'drop-shadow(0 0 6px rgba(124, 58, 237, 0.4))' }} />
          <h2 className="text-lg font-bold gradient-text">Fechamento do mês</h2>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div>
            <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Net Worth</p>
            <p className="text-xl font-bold" style={{ color: rollups.netWorth < 0 ? '#f87171' : 'var(--text-primary)' }}>
              {formatAmount(rollups.netWorth)}
            </p>
          </div>
          <div>
            <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Save</p>
            <InlineMoneyEdit
              value={rollups.save}
              onSave={onUpdateSave}
              formatAmount={formatAmount}
              valueClassName="text-xl font-bold"
              valueStyle={{ color: 'var(--text-primary)' }}
            />
          </div>
          <div>
            <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Total Saving</p>
            <p className="text-xl font-bold" style={{ color: '#22d3ee' }}>{formatAmount(rollups.totalSaving)}</p>
          </div>
          <div>
            <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Us</p>
            <p className="text-xl font-bold" style={{ color: rollups.us < 0 ? '#f87171' : 'var(--text-primary)' }}>
              {formatAmount(rollups.us)}
            </p>
          </div>
        </div>

        <div className="divider-glow mb-5" />

        <div className="grid grid-cols-2 gap-4">
          <div className="glass-card p-4 text-center">
            <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{personALabel}</p>
            <p className="text-2xl font-bold gradient-text">{formatAmount(rollups.el)}</p>
          </div>
          <div className="glass-card p-4 text-center">
            <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{personBLabel}</p>
            <p className="text-2xl font-bold gradient-text">{formatAmount(rollups.ela)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
