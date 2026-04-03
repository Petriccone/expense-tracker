'use client';

import { useMemo, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  Plus,
  Lightbulb,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useApp, useTransactions, useInsights, useSettings } from '@/context/AppContext';
import { Transaction, AIInsight } from '@/types';

const COLORS = ['#7C3AED', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#06B6D4', '#3B82F6', '#8B5CF6', '#64748B'];

export default function DashboardContent() {
  const { state } = useApp();
  const { transactions } = useTransactions();
  const { insights, setInsights } = useInsights();
  const { settings } = useSettings();

  const currencySymbol = settings.currency === 'EUR' ? '€' : settings.currency === 'USD' ? '$' : 'R$';

  // Calculate stats
  const stats = useMemo(() => {
    const now = new Date();
    const thisMonth = transactions.filter((t) => {
      const d = new Date(t.date);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });

    const income = thisMonth.filter((t) => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
    const expenses = thisMonth.filter((t) => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);

    // Last month for comparison
    const lastMonth = transactions.filter((t) => {
      const d = new Date(t.date);
      const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return d.getMonth() === lastMonthDate.getMonth() && d.getFullYear() === lastMonthDate.getFullYear();
    });
    const lastMonthExpenses = lastMonth.filter((t) => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);

    const percentChange = lastMonthExpenses > 0 ? ((expenses - lastMonthExpenses) / lastMonthExpenses) * 100 : 0;

    return { income, expenses, net: income - expenses, percentChange };
  }, [transactions]);

  // Category breakdown
  const categoryData = useMemo(() => {
    const now = new Date();
    const thisMonth = transactions.filter((t) => {
      const d = new Date(t.date);
      return t.type === 'expense' && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });

    const byCategory: Record<string, number> = {};
    thisMonth.forEach((t) => {
      byCategory[t.category] = (byCategory[t.category] || 0) + t.amount;
    });

    return Object.entries(byCategory).map(([name, value]) => ({ name, value }));
  }, [transactions]);

  // Monthly trend (last 6 months)
  const monthlyData = useMemo(() => {
    const months: { month: string; income: number; expense: number }[] = [];
    const now = new Date();

    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthName = d.toLocaleDateString('en-US', { month: 'short' });
      const monthTransactions = transactions.filter((t) => {
        const td = new Date(t.date);
        return td.getMonth() === d.getMonth() && td.getFullYear() === d.getFullYear();
      });

      const income = monthTransactions.filter((t) => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
      const expense = monthTransactions.filter((t) => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);

      months.push({ month: monthName, income, expense });
    }

    return months;
  }, [transactions]);

  // Recent transactions
  const recentTransactions = useMemo(() => {
    return [...transactions]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 8);
  }, [transactions]);

  // Generate AI insights
  useEffect(() => {
    if (transactions.length === 0) {
      setInsights([]);
      return;
    }

    const newInsights: AIInsight[] = [];
    const now = new Date();
    const thisMonth = transactions.filter((t) => {
      const d = new Date(t.date);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });

    const totalExpenses = thisMonth.filter((t) => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);

    // Budget warning
    if (totalExpenses > settings.monthlyBudget * 0.8) {
      newInsights.push({
        id: '1',
        type: 'warning',
        title: 'Budget Alert',
        description: `You've used ${Math.round((totalExpenses / settings.monthlyBudget) * 100)}% of your monthly budget.`,
        createdAt: new Date().toISOString(),
      });
    }

    // High category spending
    const categoryTotals: Record<string, number> = {};
    thisMonth.filter((t) => t.type === 'expense').forEach((t) => {
      categoryTotals[t.category] = (categoryTotals[t.category] || 0) + t.amount;
    });

    const topCategory = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])[0];
    if (topCategory && topCategory[1] > settings.monthlyBudget * 0.3) {
      newInsights.push({
        id: '2',
        type: 'info',
        title: 'Spending Pattern',
        description: `${topCategory[0]} accounts for ${Math.round((topCategory[1] / totalExpenses) * 100)}% of your expenses this month.`,
        createdAt: new Date().toISOString(),
      });
    }

    // Tip
    if (stats.net > 0) {
      const savings = Math.round(stats.net * 0.2);
      newInsights.push({
        id: '3',
        type: 'tip',
        title: 'Savings Opportunity',
        description: `Consider saving ${currencySymbol}${savings} this month (20% of your surplus) for emergencies.`,
        createdAt: new Date().toISOString(),
      });
    }

    setInsights(newInsights);
  }, [transactions, settings.monthlyBudget, stats.net, currencySymbol, setInsights]);

  const getCategoryInfo = (categoryName: string) => {
    return state.categories.find((c) => c.name === categoryName) || { icon: '📦', color: '#64748B' };
  };

  const formatAmount = (amount: number) => {
    return `${currencySymbol}${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-slate-500">Welcome back! Here's your financial overview.</p>
        </div>
        <Link
          href="/add"
          className="btn-primary flex items-center gap-2 justify-center w-fit"
        >
          <Plus className="w-5 h-5" />
          Add Transaction
        </Link>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Balance */}
        <div className="bg-white rounded-2xl p-6 shadow-sm card-hover">
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
              <Wallet className="w-6 h-6 text-purple-600" />
            </div>
            <span className={`flex items-center gap-1 text-sm font-medium ${stats.net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {stats.net >= 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
              {Math.abs(stats.percentChange).toFixed(1)}%
            </span>
          </div>
          <p className="text-slate-500 text-sm">Monthly Balance</p>
          <p className={`text-2xl font-bold ${stats.net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {formatAmount(stats.net)}
          </p>
        </div>

        {/* Income */}
        <div className="bg-white rounded-2xl p-6 shadow-sm card-hover">
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
              <TrendingUp className="w-6 h-6 text-green-600" />
            </div>
          </div>
          <p className="text-slate-500 text-sm">Monthly Income</p>
          <p className="text-2xl font-bold text-green-600">{formatAmount(stats.income)}</p>
        </div>

        {/* Expenses */}
        <div className="bg-white rounded-2xl p-6 shadow-sm card-hover">
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center">
              <TrendingDown className="w-6 h-6 text-red-600" />
            </div>
          </div>
          <p className="text-slate-500 text-sm">Monthly Expenses</p>
          <p className="text-2xl font-bold text-red-600">{formatAmount(stats.expenses)}</p>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Category Pie Chart */}
        <div className="bg-white rounded-2xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-4">Spending by Category</h2>
          {categoryData.length > 0 ? (
            <div className="chart-container">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categoryData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {categoryData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => formatAmount(Number(value))} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center text-slate-400">
              No expenses this month
            </div>
          )}
          <div className="flex flex-wrap gap-2 mt-4">
            {categoryData.slice(0, 5).map((item, index) => {
              const cat = getCategoryInfo(item.name);
              return (
                <div key={item.name} className="flex items-center gap-2 text-sm">
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                  <span className="text-slate-600">{item.name}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Monthly Bar Chart */}
        <div className="bg-white rounded-2xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-4">Monthly Trend</h2>
          {monthlyData.some((m) => m.income > 0 || m.expense > 0) ? (
            <div className="chart-container">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="month" stroke="#64748B" fontSize={12} />
                  <YAxis stroke="#64748B" fontSize={12} />
                  <Tooltip
                    formatter={(value) => formatAmount(Number(value))}
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                  />
                  <Bar dataKey="income" fill="#10B981" radius={[4, 4, 0, 0]} name="Income" />
                  <Bar dataKey="expense" fill="#EF4444" radius={[4, 4, 0, 0]} name="Expense" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center text-slate-400">
              No data yet
            </div>
          )}
        </div>
      </div>

      {/* AI Insights */}
      {insights.length > 0 && (
        <div className="bg-white rounded-2xl p-6 shadow-sm border-l-4 border-purple-500">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-5 h-5 text-purple-600" />
            <h2 className="text-lg font-semibold">AI Insights</h2>
          </div>
          <div className="space-y-3">
            {insights.map((insight) => (
              <div
                key={insight.id}
                className={`p-4 rounded-xl flex items-start gap-3 ${
                  insight.type === 'warning'
                    ? 'bg-amber-50 border border-amber-200'
                    : insight.type === 'tip'
                    ? 'bg-green-50 border border-green-200'
                    : 'bg-purple-50 border border-purple-200'
                }`}
              >
                {insight.type === 'warning' && <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />}
                {insight.type === 'tip' && <Lightbulb className="w-5 h-5 text-green-600 flex-shrink-0" />}
                {insight.type === 'info' && <Sparkles className="w-5 h-5 text-purple-600 flex-shrink-0" />}
                <div>
                  <p className="font-medium text-slate-900">{insight.title}</p>
                  <p className="text-sm text-slate-600">{insight.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Transactions */}
      <div className="bg-white rounded-2xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Recent Transactions</h2>
          <Link href="/transactions" className="text-purple-600 text-sm font-medium hover:text-purple-700">
            View All
          </Link>
        </div>
        {recentTransactions.length > 0 ? (
          <div className="space-y-3">
            {recentTransactions.map((transaction) => {
              const cat = getCategoryInfo(transaction.category);
              return (
                <div
                  key={transaction.id}
                  className="flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-lg"
                      style={{ backgroundColor: `${cat.color}20` }}
                    >
                      {cat.icon}
                    </div>
                    <div>
                      <p className="font-medium text-slate-900">{transaction.description}</p>
                      <p className="text-sm text-slate-500">
                        {new Date(transaction.date).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`font-semibold ${
                      transaction.type === 'income' ? 'text-green-600' : 'text-red-600'
                    }`}
                  >
                    {transaction.type === 'income' ? '+' : '-'}
                    {formatAmount(transaction.amount)}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-8 text-slate-400">
            <p>No transactions yet</p>
            <Link href="/add" className="text-purple-600 font-medium hover:underline mt-2 inline-block">
              Add your first transaction
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}