'use client';

// The couple's budget page — planned/spent per category (Fixos/Variáveis/
// Extras), income, and the month-close payoff (Net Worth → Save → Total
// Saving → Us → El/Ela). Fully server-backed via /api/budget/* — no
// AppContext/localStorage. See docs/2026-08-15-budget-model-redesign-design.md.

import { useMemo, useState } from 'react';
import { AlertTriangle, Target, X } from 'lucide-react';
import { formatMoney, monthLabel, useBudget } from '@/lib/useBudget';
import MonthSwitcher from '@/components/budget/MonthSwitcher';
import CategoryGroupCard from '@/components/budget/CategoryGroupCard';
import IncomeBlock from '@/components/budget/IncomeBlock';
import MonthCloseCard from '@/components/budget/MonthCloseCard';
import type { BudgetGroup } from '@/types/budget';

const GROUPS: { key: BudgetGroup; label: string }[] = [
  { key: 'fixed', label: 'Fixos' },
  { key: 'variable', label: 'Variáveis' },
  { key: 'extra', label: 'Extras' },
];

export default function BudgetPage() {
  const {
    month,
    settings,
    bankSpent,
    bankSpentReady,
    loading,
    error,
    clearError,
    isLatest,
    canGoPrev,
    canGoNext,
    goToPrevMonth,
    goToNextMonth,
    reload,
    createNextMonth,
    updateSave,
    addCategory,
    updateCategory,
    deleteCategory,
    addIncome,
    updateIncome,
    deleteIncome,
  } = useBudget();

  const [creatingMonth, setCreatingMonth] = useState(false);

  const currency = settings?.currency ?? 'EUR';
  const formatAmount = useMemo(() => (n: number) => formatMoney(n, currency), [currency]);

  const handleCreateNext = async () => {
    setCreatingMonth(true);
    try {
      await createNextMonth();
    } catch {
      // error surfaced via the banner below
    } finally {
      setCreatingMonth(false);
    }
  };

  if (loading && !month) {
    return (
      <div className="flex items-center justify-center" style={{ minHeight: '50vh' }}>
        <div
          style={{
            width: 36,
            height: 36,
            border: '3px solid var(--border-color)',
            borderTopColor: '#7C3AED',
            borderRadius: '50%',
            animation: 'spin 0.6s linear infinite',
            boxShadow: '0 0 20px rgba(124, 58, 237, 0.3)',
          }}
        />
      </div>
    );
  }

  if (!month) {
    return (
      <div className="glass-card-static p-8 text-center" style={{ borderLeft: '3px solid #7C3AED' }}>
        <Target className="w-10 h-10 mx-auto mb-3" style={{ color: '#a78bfa', filter: 'drop-shadow(0 0 8px rgba(124, 58, 237, 0.3))' }} />
        <h3 className="font-semibold mb-1 gradient-text">Não deu para carregar o orçamento</h3>
        <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
          {error ?? 'Nenhum mês encontrado ainda.'}
        </p>
        <button onClick={reload} className="btn-primary">Tentar de novo</button>
      </div>
    );
  }

  const categoriesByGroup = (g: BudgetGroup) => month.categories.filter((c) => c.group === g);

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold gradient-text flex items-center gap-2">
            <Target className="w-7 h-7" style={{ color: '#a78bfa', filter: 'drop-shadow(0 0 6px rgba(124, 58, 237, 0.4))' }} />
            Orçamento
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>Planejado, gasto e o fechamento do mês do casal</p>
        </div>

        <MonthSwitcher
          label={monthLabel(month.year, month.month)}
          canGoPrev={canGoPrev}
          canGoNext={canGoNext}
          isLatest={isLatest}
          creating={creatingMonth}
          onPrev={goToPrevMonth}
          onNext={goToNextMonth}
          onCreateNext={handleCreateNext}
        />
      </div>

      {error && (
        <div className="glass-card-static p-4 flex items-center justify-between gap-3" style={{ borderLeft: '3px solid #EF4444' }}>
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{error}</p>
          </div>
          <button onClick={clearError} className="p-1 rounded-lg flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Fixos / Variáveis / Extras */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 stagger-children">
        {GROUPS.map(({ key, label }) => (
          <CategoryGroupCard
            key={key}
            group={key}
            label={label}
            categories={categoriesByGroup(key)}
            bankSpent={bankSpent}
            bankSpentReady={bankSpentReady}
            formatAmount={formatAmount}
            onUpdateCategory={updateCategory}
            onDeleteCategory={deleteCategory}
            onAddCategory={addCategory}
          />
        ))}
      </div>

      {/* Renda */}
      <IncomeBlock
        incomes={month.incomes}
        formatAmount={formatAmount}
        accountBalance={month.accountBalance}
        onUpdateIncome={updateIncome}
        onDeleteIncome={deleteIncome}
        onAddIncome={addIncome}
      />

      {/* Fechamento do mês */}
      <MonthCloseCard
        rollups={month.rollups}
        personALabel={settings?.personALabel ?? 'Rafael'}
        personBLabel={settings?.personBLabel ?? 'Rafaela'}
        formatAmount={formatAmount}
        onUpdateSave={updateSave}
      />
    </div>
  );
}
