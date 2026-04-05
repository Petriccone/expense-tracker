'use client';

import { useMemo, useState } from 'react';
import { Download, Calendar } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from 'recharts';
import { useTransactions, useSettings } from '@/context/AppContext';

const COLORS = ['#7C3AED', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#06B6D4', '#3B82F6', '#8B5CF6', '#64748B'];

export default function ReportsPage() {
  const { transactions } = useTransactions();
  const { settings } = useSettings();
  const [dateRange, setDateRange] = useState('month');

  const currencySymbol = settings.currency === 'EUR' ? '€' : settings.currency === 'USD' ? '$' : 'R$';

  const formatAmount = (amount: number) => {
    return `${currencySymbol}${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Filter transactions based on date range
  const filteredTransactions = useMemo(() => {
    const now = new Date();
    return transactions.filter((t) => {
      const d = new Date(t.date);
      if (dateRange === 'week') {
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        return d >= weekAgo;
      } else if (dateRange === 'month') {
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      } else if (dateRange === 'year') {
        return d.getFullYear() === now.getFullYear();
      }
      return true;
    });
  }, [transactions, dateRange]);

  // Stats
  const stats = useMemo(() => {
    const income = filteredTransactions
      .filter((t) => t.type === 'income')
      .reduce((sum, t) => sum + t.amount, 0);
    const expenses = filteredTransactions
      .filter((t) => t.type === 'expense')
      .reduce((sum, t) => sum + t.amount, 0);
    return { income, expenses, net: income - expenses, total: income + expenses };
  }, [filteredTransactions]);

  // Category breakdown
  const categoryData = useMemo(() => {
    const byCategory: Record<string, number> = {};
    filteredTransactions
      .filter((t) => t.type === 'expense')
      .forEach((t) => {
        byCategory[t.category] = (byCategory[t.category] || 0) + t.amount;
      });
    return Object.entries(byCategory)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredTransactions]);

  // Monthly data for the year
  const monthlyData = useMemo(() => {
    const months: Record<string, { income: number; expense: number }> = {};
    const now = new Date();

    // Initialize all months
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), i, 1);
      const key = d.toLocaleDateString('en-US', { month: 'short' });
      months[key] = { income: 0, expense: 0 };
    }

    transactions.forEach((t) => {
      const d = new Date(t.date);
      if (d.getFullYear() === now.getFullYear()) {
        const key = d.toLocaleDateString('en-US', { month: 'short' });
        if (months[key]) {
          if (t.type === 'income') {
            months[key].income += t.amount;
          } else {
            months[key].expense += t.amount;
          }
        }
      }
    });

    return Object.entries(months).map(([month, data]) => ({
      month,
      ...data,
    }));
  }, [transactions]);

  // Export to CSV
  const handleExport = () => {
    const headers = ['Date', 'Description', 'Category', 'Type', 'Amount'];
    const rows = filteredTransactions.map((t) => [
      t.date,
      t.description,
      t.category,
      t.type,
      t.amount.toString(),
    ]);

    const escapeCsvField = (field: string) => {
      if (field.includes(',') || field.includes('"') || field.includes('\n')) {
        return `"${field.replace(/"/g, '""')}"`;
      }
      return field;
    };
    const csv = [headers, ...rows].map((row) => row.map(escapeCsvField).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `expenses-${dateRange}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const tooltipStyle = {
    background: '#151d33',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 12,
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
    color: '#e8edf5',
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold gradient-text">Reports</h1>
          <p style={{ color: '#8892a8' }}>Analyze your spending patterns</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="select-field"
          >
            <option value="week">This Week</option>
            <option value="month">This Month</option>
            <option value="year">This Year</option>
          </select>
          <button onClick={handleExport} className="btn-secondary flex items-center gap-2">
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger-children">
        <div className="glass-card p-4">
          <p className="text-sm" style={{ color: '#8892a8' }}>Total Income</p>
          <p className="text-xl font-bold text-green-400">{formatAmount(stats.income)}</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-sm" style={{ color: '#8892a8' }}>Total Expenses</p>
          <p className="text-xl font-bold text-red-400">{formatAmount(stats.expenses)}</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-sm" style={{ color: '#8892a8' }}>Net</p>
          <p className={`text-xl font-bold ${stats.net >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {formatAmount(stats.net)}
          </p>
        </div>
        <div className="glass-card p-4">
          <p className="text-sm" style={{ color: '#8892a8' }}>Transactions</p>
          <p className="text-xl font-bold" style={{ color: '#e8edf5' }}>{filteredTransactions.length}</p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Monthly Trend */}
        <div className="glass-card-static p-6">
          <h2 className="text-lg font-semibold mb-4" style={{ color: '#e8edf5' }}>Income vs Expenses (Year)</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="month" stroke="#5a6478" fontSize={12} />
                <YAxis stroke="#5a6478" fontSize={12} />
                <Tooltip
                  formatter={(value) => formatAmount(Number(value))}
                  contentStyle={tooltipStyle}
                  itemStyle={{ color: '#e8edf5' }}
                  labelStyle={{ color: '#8892a8' }}
                />
                <Bar dataKey="income" fill="#10B981" name="Income" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expense" fill="#EF4444" name="Expense" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Category Breakdown */}
        <div className="glass-card-static p-6">
          <h2 className="text-lg font-semibold mb-4" style={{ color: '#e8edf5' }}>Expenses by Category</h2>
          {categoryData.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categoryData}
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    dataKey="value"
                    stroke="none"
                    label={({ name, percent }) => `${name} (${((percent || 0) * 100).toFixed(0)}%)`}
                    labelLine={false}
                  >
                    {categoryData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => formatAmount(Number(value))}
                    contentStyle={tooltipStyle}
                    itemStyle={{ color: '#e8edf5' }}
                    labelStyle={{ color: '#8892a8' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center" style={{ color: '#5a6478' }}>
              No expense data
            </div>
          )}
        </div>
      </div>

      {/* Category Table */}
      <div className="glass-card-static p-6">
        <h2 className="text-lg font-semibold mb-4" style={{ color: '#e8edf5' }}>Category Breakdown</h2>
        {categoryData.length > 0 ? (
          <div className="space-y-3">
            {categoryData.map((cat, index) => {
              const percentage = (cat.value / stats.expenses) * 100;
              return (
                <div key={cat.name} className="flex items-center gap-4">
                  <div
                    className="w-4 h-4 rounded-full"
                    style={{
                      backgroundColor: COLORS[index % COLORS.length],
                      boxShadow: `0 0 6px ${COLORS[index % COLORS.length]}40`,
                    }}
                  />
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium" style={{ color: '#e8edf5' }}>{cat.name}</span>
                      <span style={{ color: '#8892a8' }}>{formatAmount(cat.value)}</span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${percentage}%`,
                          backgroundColor: COLORS[index % COLORS.length],
                          boxShadow: `0 0 8px ${COLORS[index % COLORS.length]}30`,
                        }}
                      />
                    </div>
                  </div>
                  <span className="text-sm w-12 text-right" style={{ color: '#5a6478' }}>{percentage.toFixed(1)}%</span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-center py-8" style={{ color: '#5a6478' }}>No data available</p>
        )}
      </div>
    </div>
  );
}
