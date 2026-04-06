'use client';

import { useState, useMemo } from 'react';
import {
  Target,
  Edit2,
  Check,
  X,
  PiggyBank,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  TrendingUp,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { useTransactions, useCategories, useSettings, useCategoryBudgets } from '@/context/AppContext';

export default function BudgetPage() {
  const { transactions } = useTransactions();
  const { categories } = useCategories();
  const { settings } = useSettings();
  const { categoryBudgets, updateCategoryBudget } = useCategoryBudgets();

  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const currencySymbol = settings.currency === 'EUR' ? '€' : settings.currency === 'USD' ? '$' : 'R$';

  const formatAmount = (amount: number) => {
    return `${currencySymbol}${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const monthLabel = selectedMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const navigateMonth = (direction: number) => {
    setSelectedMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + direction, 1));
  };

  const expenseCategories = useMemo(() => {
    return categories.filter((c) => c.type === 'expense');
  }, [categories]);

  // Compute spending per category for the selected month
  const categorySpending = useMemo(() => {
    const monthTransactions = transactions.filter((t) => {
      const d = new Date(t.date);
      return (
        t.type === 'expense' &&
        d.getMonth() === selectedMonth.getMonth() &&
        d.getFullYear() === selectedMonth.getFullYear()
      );
    });

    const totals: Record<string, number> = {};
    monthTransactions.forEach((t) => {
      totals[t.category] = (totals[t.category] || 0) + t.amount;
    });
    return totals;
  }, [transactions, selectedMonth]);

  // Build per-category budget data
  const budgetData = useMemo(() => {
    return expenseCategories.map((cat) => {
      const budget = categoryBudgets.find((b) => b.categoryId === cat.id);
      const limit = budget?.limit || 0;
      const spent = categorySpending[cat.name] || 0;
      const percentage = limit > 0 ? (spent / limit) * 100 : 0;
      return { category: cat, limit, spent, percentage };
    });
  }, [expenseCategories, categoryBudgets, categorySpending]);

  // Overall stats
  const overallStats = useMemo(() => {
    const totalAllocated = budgetData.reduce((sum, d) => sum + d.limit, 0);
    const totalSpent = budgetData.reduce((sum, d) => sum + d.spent, 0);
    const unallocated = settings.monthlyBudget - totalAllocated;
    const categoriesOverBudget = budgetData.filter((d) => d.limit > 0 && d.spent > d.limit).length;
    return { totalAllocated, totalSpent, unallocated, categoriesOverBudget };
  }, [budgetData, settings.monthlyBudget]);

  // Chart data (only categories with a budget or spending)
  const chartData = useMemo(() => {
    return budgetData
      .filter((d) => d.limit > 0 || d.spent > 0)
      .map((d) => ({
        name: d.category.name,
        budget: d.limit,
        spent: d.spent,
        color: d.category.color,
      }));
  }, [budgetData]);

  const handleStartEdit = (categoryId: string) => {
    const existing = categoryBudgets.find((b) => b.categoryId === categoryId);
    setEditingCategoryId(categoryId);
    setEditValue(existing ? existing.limit.toString() : '');
  };

  const handleSaveEdit = () => {
    if (editingCategoryId === null) return;
    const limit = parseFloat(editValue) || 0;
    if (limit >= 0) {
      updateCategoryBudget({ categoryId: editingCategoryId, limit });
    }
    setEditingCategoryId(null);
    setEditValue('');
  };

  const handleCancelEdit = () => {
    setEditingCategoryId(null);
    setEditValue('');
  };

  const getProgressColor = (percentage: number, baseColor: string) => {
    if (percentage > 100) return '#EF4444';
    if (percentage > 80) return '#F59E0B';
    return baseColor;
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold gradient-text flex items-center gap-2">
            <Target className="w-7 h-7" style={{ color: '#a78bfa', filter: 'drop-shadow(0 0 6px rgba(124, 58, 237, 0.4))' }} />
            Budget Planning
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>Set per-category spending limits and track your progress</p>
        </div>

        {/* Month Navigator */}
        <div
          className="glass-card-static flex items-center gap-2 px-2 py-1"
          style={{ borderRadius: 14 }}
        >
          <button
            onClick={() => navigateMonth(-1)}
            className="p-2 rounded-lg transition-colors"
            style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover-bg)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="text-sm font-semibold min-w-[140px] text-center" style={{ color: 'var(--text-primary)' }}>
            {monthLabel}
          </span>
          <button
            onClick={() => navigateMonth(1)}
            className="p-2 rounded-lg transition-colors"
            style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover-bg)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Overall Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 stagger-children">
        <div className="glass-card p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(124, 58, 237, 0.12)', boxShadow: '0 0 12px rgba(124, 58, 237, 0.1)' }}>
              <PiggyBank className="w-5 h-5" style={{ color: '#a78bfa' }} />
            </div>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Total Budget</p>
          </div>
          <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{formatAmount(settings.monthlyBudget)}</p>
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(6, 182, 212, 0.12)', boxShadow: '0 0 12px rgba(6, 182, 212, 0.1)' }}>
              <Target className="w-5 h-5" style={{ color: '#22d3ee' }} />
            </div>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Allocated</p>
          </div>
          <p className={`text-2xl font-bold ${overallStats.totalAllocated <= settings.monthlyBudget ? 'text-cyan-400' : 'text-amber-400'}`}>
            {formatAmount(overallStats.totalAllocated)}
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            {settings.monthlyBudget > 0
              ? `${Math.round((overallStats.totalAllocated / settings.monthlyBudget) * 100)}% of total budget`
              : 'No total budget set'}
          </p>
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(16, 185, 129, 0.12)', boxShadow: '0 0 12px rgba(16, 185, 129, 0.1)' }}>
              <TrendingUp className="w-5 h-5 text-green-400" />
            </div>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Unallocated</p>
          </div>
          <p className={`text-2xl font-bold ${overallStats.unallocated >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {formatAmount(overallStats.unallocated)}
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            {overallStats.unallocated < 0 ? 'Over-allocated!' : 'Available to assign'}
          </p>
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center`}
              style={{
                background: overallStats.categoriesOverBudget > 0 ? 'rgba(239, 68, 68, 0.12)' : 'rgba(16, 185, 129, 0.12)',
                boxShadow: overallStats.categoriesOverBudget > 0 ? '0 0 12px rgba(239, 68, 68, 0.1)' : '0 0 12px rgba(16, 185, 129, 0.1)',
              }}>
              <AlertTriangle className={`w-5 h-5 ${overallStats.categoriesOverBudget > 0 ? 'text-red-400' : 'text-green-400'}`} />
            </div>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Over Budget</p>
          </div>
          <p className={`text-2xl font-bold ${overallStats.categoriesOverBudget > 0 ? 'text-red-400' : 'text-green-400'}`}>
            {overallStats.categoriesOverBudget}
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            {overallStats.categoriesOverBudget > 0
              ? `${overallStats.categoriesOverBudget} categor${overallStats.categoriesOverBudget === 1 ? 'y' : 'ies'} exceeded`
              : 'All categories on track'}
          </p>
        </div>
      </div>

      {/* Allocation Progress Bar */}
      {overallStats.totalAllocated > 0 && (
        <div className="glass-card-static p-6">
          <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>Budget Allocation</h2>
          <div className="h-4 rounded-full overflow-hidden flex" style={{ background: 'var(--bg-input)' }}>
            {budgetData
              .filter((d) => d.limit > 0)
              .map((d) => {
                const widthPercent = (d.limit / settings.monthlyBudget) * 100;
                return (
                  <div
                    key={d.category.id}
                    className="h-full transition-all duration-300"
                    style={{
                      width: `${Math.min(widthPercent, 100)}%`,
                      backgroundColor: d.category.color,
                      boxShadow: `0 0 8px ${d.category.color}40`,
                    }}
                    title={`${d.category.name}: ${formatAmount(d.limit)}`}
                  />
                );
              })}
          </div>
          <div className="flex flex-wrap gap-3 mt-3">
            {budgetData
              .filter((d) => d.limit > 0)
              .map((d) => (
                <div key={d.category.id} className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  <span className="w-2.5 h-2.5 rounded-full" style={{
                    backgroundColor: d.category.color,
                    boxShadow: `0 0 4px ${d.category.color}40`,
                  }} />
                  {d.category.name}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Per-Category Budget List */}
      <div className="glass-card-static p-6">
        <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Category Budgets</h2>
        <div className="space-y-4">
          {budgetData.map((item) => {
            const isEditing = editingCategoryId === item.category.id;
            const progressColor = getProgressColor(item.percentage, item.category.color);

            return (
              <div key={item.category.id} className="group">
                <div className="flex items-center gap-4">
                  {/* Category icon */}
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                    style={{ backgroundColor: `${item.category.color}18` }}
                  >
                    {item.category.icon}
                  </div>

                  {/* Name + progress */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>{item.category.name}</span>
                      <div className="flex items-center gap-2">
                        {isEditing ? (
                          <div className="flex items-center gap-1">
                            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{currencySymbol}</span>
                            <input
                              type="number"
                              step="10"
                              min="0"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveEdit();
                                if (e.key === 'Escape') handleCancelEdit();
                              }}
                              className="w-24 px-2 py-1 text-sm rounded-lg"
                              style={{
                                background: 'var(--bg-input)',
                                border: '1px solid rgba(124, 58, 237, 0.3)',
                                color: 'var(--text-primary)',
                                outline: 'none',
                              }}
                              autoFocus
                            />
                            <button
                              onClick={handleSaveEdit}
                              className="p-1 text-green-400 rounded-lg transition-colors"
                              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(16, 185, 129, 0.1)'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              onClick={handleCancelEdit}
                              className="p-1 rounded-lg transition-colors"
                              style={{ color: 'var(--text-muted)' }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover-bg)'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                              {item.limit > 0 ? (
                                <>
                                  <span style={{ color: item.spent > item.limit ? '#f87171' : '#8892a8', fontWeight: item.spent > item.limit ? 600 : 400 }}>
                                    {formatAmount(item.spent)}
                                  </span>
                                  <span style={{ color: 'var(--text-muted)' }}> / </span>
                                  <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{formatAmount(item.limit)}</span>
                                </>
                              ) : (
                                <span style={{ color: 'var(--text-muted)' }}>{formatAmount(item.spent)} spent</span>
                              )}
                            </span>
                            <button
                              onClick={() => handleStartEdit(item.category.id)}
                              className="p-1 rounded-lg transition-all"
                              style={{ color: 'var(--text-muted)' }}
                              onMouseEnter={(e) => { e.currentTarget.style.color = '#a78bfa'; e.currentTarget.style.background = 'rgba(124, 58, 237, 0.1)'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.color = '#5a6478'; e.currentTarget.style.background = 'transparent'; }}
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Progress bar */}
                    {item.limit > 0 ? (
                      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-input)' }}>
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.min(item.percentage, 100)}%`,
                            backgroundColor: progressColor,
                            boxShadow: `0 0 8px ${progressColor}40`,
                          }}
                        />
                      </div>
                    ) : (
                      <div
                        className="h-4 border border-dashed rounded-full cursor-pointer transition-colors"
                        style={{ borderColor: 'var(--border-color)' }}
                        onClick={() => handleStartEdit(item.category.id)}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(124, 58, 237, 0.3)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
                      />
                    )}

                    {/* Percentage label */}
                    {item.limit > 0 && (
                      <div className="flex justify-between mt-1">
                        <span className={`text-xs ${item.percentage > 100 ? 'text-red-400 font-medium' : ''}`}
                          style={{ color: item.percentage > 100 ? undefined : '#5a6478' }}>
                          {item.percentage > 100
                            ? `${formatAmount(item.spent - item.limit)} over budget`
                            : `${formatAmount(item.limit - item.spent)} remaining`}
                        </span>
                        <span className={`text-xs font-medium ${item.percentage > 100 ? 'text-red-400' : item.percentage > 80 ? 'text-amber-400' : ''}`}
                          style={{ color: item.percentage <= 80 ? '#5a6478' : undefined }}>
                          {item.percentage.toFixed(0)}%
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Budget vs Actual Chart */}
      {chartData.length > 0 && (
        <div className="glass-card-static p-6">
          <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Budget vs Actual</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={11} angle={-20} textAnchor="end" height={60} />
                <YAxis stroke="var(--text-muted)" fontSize={12} />
                <Tooltip
                  formatter={(value) => formatAmount(Number(value))}
                  contentStyle={{
                    background: 'var(--tooltip-bg)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: 12,
                    boxShadow: 'var(--tooltip-shadow)',
                    color: 'var(--text-primary)',
                  }}
                  itemStyle={{ color: 'var(--text-primary)' }}
                  labelStyle={{ color: 'var(--text-secondary)' }}
                />
                <Bar dataKey="budget" fill="var(--border-color)" name="Budget" radius={[4, 4, 0, 0]} />
                <Bar dataKey="spent" name="Spent" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.spent > entry.budget ? '#EF4444' : entry.color}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Empty state hint */}
      {budgetData.every((d) => d.limit === 0) && (
        <div
          className="glass-card-static p-6 text-center"
          style={{ borderLeft: '3px solid #7C3AED' }}
        >
          <Target className="w-10 h-10 mx-auto mb-3" style={{ color: '#a78bfa', filter: 'drop-shadow(0 0 8px rgba(124, 58, 237, 0.3))' }} />
          <h3 className="font-semibold mb-1 gradient-text">No budgets set yet</h3>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Click the edit icon next to any category above to set a monthly spending limit.
            Your total monthly budget is {formatAmount(settings.monthlyBudget)} (configurable in Settings).
          </p>
        </div>
      )}
    </div>
  );
}
