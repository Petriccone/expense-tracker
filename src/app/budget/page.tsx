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
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900 flex items-center gap-2">
            <Target className="w-7 h-7 text-purple-600" />
            Budget Planning
          </h1>
          <p className="text-slate-500">Set per-category spending limits and track your progress</p>
        </div>

        {/* Month Navigator */}
        <div className="flex items-center gap-2 bg-white rounded-xl shadow-sm px-2 py-1">
          <button
            onClick={() => navigateMonth(-1)}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-slate-600" />
          </button>
          <span className="text-sm font-semibold text-slate-700 min-w-[140px] text-center">
            {monthLabel}
          </span>
          <button
            onClick={() => navigateMonth(1)}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <ChevronRight className="w-5 h-5 text-slate-600" />
          </button>
        </div>
      </div>

      {/* Overall Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
              <PiggyBank className="w-5 h-5 text-purple-600" />
            </div>
            <p className="text-sm text-slate-500">Total Budget</p>
          </div>
          <p className="text-2xl font-bold text-slate-900">{formatAmount(settings.monthlyBudget)}</p>
        </div>

        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
              <Target className="w-5 h-5 text-blue-600" />
            </div>
            <p className="text-sm text-slate-500">Allocated</p>
          </div>
          <p className={`text-2xl font-bold ${overallStats.totalAllocated <= settings.monthlyBudget ? 'text-blue-600' : 'text-amber-600'}`}>
            {formatAmount(overallStats.totalAllocated)}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {settings.monthlyBudget > 0
              ? `${Math.round((overallStats.totalAllocated / settings.monthlyBudget) * 100)}% of total budget`
              : 'No total budget set'}
          </p>
        </div>

        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-green-600" />
            </div>
            <p className="text-sm text-slate-500">Unallocated</p>
          </div>
          <p className={`text-2xl font-bold ${overallStats.unallocated >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {formatAmount(overallStats.unallocated)}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {overallStats.unallocated < 0 ? 'Over-allocated!' : 'Available to assign'}
          </p>
        </div>

        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${overallStats.categoriesOverBudget > 0 ? 'bg-red-100' : 'bg-green-100'}`}>
              <AlertTriangle className={`w-5 h-5 ${overallStats.categoriesOverBudget > 0 ? 'text-red-600' : 'text-green-600'}`} />
            </div>
            <p className="text-sm text-slate-500">Over Budget</p>
          </div>
          <p className={`text-2xl font-bold ${overallStats.categoriesOverBudget > 0 ? 'text-red-600' : 'text-green-600'}`}>
            {overallStats.categoriesOverBudget}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {overallStats.categoriesOverBudget > 0
              ? `${overallStats.categoriesOverBudget} categor${overallStats.categoriesOverBudget === 1 ? 'y' : 'ies'} exceeded`
              : 'All categories on track'}
          </p>
        </div>
      </div>

      {/* Allocation Progress Bar */}
      {overallStats.totalAllocated > 0 && (
        <div className="bg-white rounded-2xl p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Budget Allocation</h2>
          <div className="h-4 bg-slate-100 rounded-full overflow-hidden flex">
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
                <div key={d.category.id} className="flex items-center gap-1.5 text-xs text-slate-600">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.category.color }} />
                  {d.category.name}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Per-Category Budget List */}
      <div className="bg-white rounded-2xl p-6 shadow-sm">
        <h2 className="text-lg font-semibold mb-4">Category Budgets</h2>
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
                    style={{ backgroundColor: `${item.category.color}20` }}
                  >
                    {item.category.icon}
                  </div>

                  {/* Name + progress */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-slate-800 text-sm">{item.category.name}</span>
                      <div className="flex items-center gap-2">
                        {isEditing ? (
                          <div className="flex items-center gap-1">
                            <span className="text-sm text-slate-400">{currencySymbol}</span>
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
                              className="w-24 px-2 py-1 text-sm border border-purple-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                              autoFocus
                            />
                            <button
                              onClick={handleSaveEdit}
                              className="p-1 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              onClick={handleCancelEdit}
                              className="p-1 text-slate-400 hover:bg-slate-100 rounded-lg transition-colors"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-slate-600">
                              {item.limit > 0 ? (
                                <>
                                  <span className={item.spent > item.limit ? 'text-red-600 font-semibold' : ''}>
                                    {formatAmount(item.spent)}
                                  </span>
                                  <span className="text-slate-400"> / </span>
                                  <span className="font-medium">{formatAmount(item.limit)}</span>
                                </>
                              ) : (
                                <span className="text-slate-400">{formatAmount(item.spent)} spent</span>
                              )}
                            </span>
                            <button
                              onClick={() => handleStartEdit(item.category.id)}
                              className="p-1 text-slate-300 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Progress bar */}
                    {item.limit > 0 ? (
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.min(item.percentage, 100)}%`,
                            backgroundColor: progressColor,
                          }}
                        />
                      </div>
                    ) : (
                      <div
                        className="h-2 border border-dashed border-slate-200 rounded-full cursor-pointer hover:border-purple-300 transition-colors"
                        onClick={() => handleStartEdit(item.category.id)}
                      />
                    )}

                    {/* Percentage label */}
                    {item.limit > 0 && (
                      <div className="flex justify-between mt-1">
                        <span className={`text-xs ${item.percentage > 100 ? 'text-red-500 font-medium' : 'text-slate-400'}`}>
                          {item.percentage > 100
                            ? `${formatAmount(item.spent - item.limit)} over budget`
                            : `${formatAmount(item.limit - item.spent)} remaining`}
                        </span>
                        <span className={`text-xs font-medium ${item.percentage > 100 ? 'text-red-500' : item.percentage > 80 ? 'text-amber-500' : 'text-slate-400'}`}>
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
        <div className="bg-white rounded-2xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-4">Budget vs Actual</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="name" stroke="#64748B" fontSize={11} angle={-20} textAnchor="end" height={60} />
                <YAxis stroke="#64748B" fontSize={12} />
                <Tooltip
                  formatter={(value: number, name: string) => [formatAmount(value), name === 'budget' ? 'Budget' : 'Spent']}
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                />
                <Bar dataKey="budget" fill="#E2E8F0" name="Budget" radius={[4, 4, 0, 0]} />
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
        <div className="bg-purple-50 rounded-2xl p-6 border border-purple-200 text-center">
          <Target className="w-10 h-10 text-purple-400 mx-auto mb-3" />
          <h3 className="font-semibold text-purple-800 mb-1">No budgets set yet</h3>
          <p className="text-sm text-purple-600">
            Click the edit icon next to any category above to set a monthly spending limit.
            Your total monthly budget is {formatAmount(settings.monthlyBudget)} (configurable in Settings).
          </p>
        </div>
      )}
    </div>
  );
}
