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
  ChevronLeft,
  ChevronRight,
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

  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const navigateMonth = (dir: number) => {
    setSelectedMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + dir, 1));
  };

  const monthLabel = selectedMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  const currencySymbol = settings.currency === 'EUR' ? '€' : settings.currency === 'USD' ? '$' : 'R$';

  // Calculate stats for selected month
  const stats = useMemo(() => {
    const thisMonth = transactions.filter((t) => {
      const d = new Date(t.date);
      return d.getMonth() === selectedMonth.getMonth() && d.getFullYear() === selectedMonth.getFullYear();
    });

    const income = thisMonth.filter((t) => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
    const expenses = thisMonth.filter((t) => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);

    // Previous month for comparison
    const prevMonthDate = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() - 1, 1);
    const lastMonth = transactions.filter((t) => {
      const d = new Date(t.date);
      return d.getMonth() === prevMonthDate.getMonth() && d.getFullYear() === prevMonthDate.getFullYear();
    });
    const lastMonthExpenses = lastMonth.filter((t) => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);

    const percentChange = lastMonthExpenses > 0 ? ((expenses - lastMonthExpenses) / lastMonthExpenses) * 100 : 0;

    return { income, expenses, net: income - expenses, percentChange };
  }, [transactions, selectedMonth]);

  // Category breakdown for selected month
  const categoryData = useMemo(() => {
    const thisMonth = transactions.filter((t) => {
      const d = new Date(t.date);
      return t.type === 'expense' && d.getMonth() === selectedMonth.getMonth() && d.getFullYear() === selectedMonth.getFullYear();
    });

    const byCategory: Record<string, number> = {};
    thisMonth.forEach((t) => {
      byCategory[t.category] = (byCategory[t.category] || 0) + t.amount;
    });

    return Object.entries(byCategory).map(([name, value]) => ({ name, value }));
  }, [transactions, selectedMonth]);

  // Monthly trend (last 6 months)
  const monthlyData = useMemo(() => {
    const months: { month: string; income: number; expense: number }[] = [];
    const now = new Date();

    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthName = d.toLocaleDateString('pt-BR', { month: 'short' });
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

  // Recent transactions for selected month
  const recentTransactions = useMemo(() => {
    return [...transactions]
      .filter((t) => {
        const d = new Date(t.date);
        return d.getMonth() === selectedMonth.getMonth() && d.getFullYear() === selectedMonth.getFullYear();
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 8);
  }, [transactions, selectedMonth]);

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
        title: 'Alerta de Orçamento',
        description: `Você usou ${Math.round((totalExpenses / settings.monthlyBudget) * 100)}% do seu orçamento mensal.`,
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
        title: 'Padrão de Gastos',
        description: `${topCategory[0]} representa ${Math.round((topCategory[1] / totalExpenses) * 100)}% das suas despesas este mês.`,
        createdAt: new Date().toISOString(),
      });
    }

    // Tip
    if (stats.net > 0) {
      const savings = Math.round(stats.net * 0.2);
      newInsights.push({
        id: '3',
        type: 'tip',
        title: 'Oportunidade de Economia',
        description: `Considere economizar ${currencySymbol}${savings} este mês (20% do seu excedente) para emergências.`,
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
          <h1 className="text-2xl md:text-3xl font-bold gradient-text">Painel</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Visão geral das suas finanças.</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Month Navigator */}
          <div className="glass-card-static flex items-center gap-1 px-2 py-1" style={{ borderRadius: 14 }}>
            <button
              onClick={() => navigateMonth(-1)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 8, color: 'var(--text-secondary)', display: 'flex' }}
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="text-sm font-semibold min-w-[130px] text-center capitalize" style={{ color: 'var(--text-primary)' }}>
              {monthLabel}
            </span>
            <button
              onClick={() => navigateMonth(1)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 8, color: 'var(--text-secondary)', display: 'flex' }}
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
          <Link
            href="/add"
            className="btn-primary flex items-center gap-2 justify-center"
          >
            <Plus className="w-5 h-5" />
            <span className="hidden md:inline">Adicionar Transação</span>
          </Link>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 stagger-children">
        {/* Balance */}
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, rgba(124, 58, 237, 0.15), rgba(6, 182, 212, 0.08))',
                boxShadow: '0 0 15px rgba(124, 58, 237, 0.15)',
              }}
            >
              <Wallet className="w-6 h-6" style={{ color: '#a78bfa' }} />
            </div>
            <span className={`flex items-center gap-1 text-sm font-medium ${stats.net >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {stats.net >= 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
              {Math.abs(stats.percentChange).toFixed(1)}%
            </span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Saldo Mensal</p>
          <p className={`text-2xl font-bold ${stats.net >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {formatAmount(stats.net)}
          </p>
        </div>

        {/* Income */}
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: 'rgba(16, 185, 129, 0.12)',
                boxShadow: '0 0 15px rgba(16, 185, 129, 0.1)',
              }}
            >
              <TrendingUp className="w-6 h-6 text-green-400" />
            </div>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Receita Mensal</p>
          <p className="text-2xl font-bold text-green-400">{formatAmount(stats.income)}</p>
        </div>

        {/* Expenses */}
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: 'rgba(239, 68, 68, 0.12)',
                boxShadow: '0 0 15px rgba(239, 68, 68, 0.1)',
              }}
            >
              <TrendingDown className="w-6 h-6 text-red-400" />
            </div>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Despesas Mensais</p>
          <p className="text-2xl font-bold text-red-400">{formatAmount(stats.expenses)}</p>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Category Pie Chart */}
        <div className="glass-card-static p-6">
          <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Gastos por Categoria</h2>
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
                    stroke="none"
                  >
                    {categoryData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
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
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>
              Sem despesas este mês
            </div>
          )}
          <div className="flex flex-wrap gap-2 mt-4">
            {categoryData.slice(0, 5).map((item, index) => {
              const cat = getCategoryInfo(item.name);
              return (
                <div key={item.name} className="flex items-center gap-2 text-sm">
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{
                      backgroundColor: COLORS[index % COLORS.length],
                      boxShadow: `0 0 6px ${COLORS[index % COLORS.length]}40`,
                    }}
                  />
                  <span style={{ color: 'var(--text-secondary)' }}>{item.name}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Monthly Bar Chart */}
        <div className="glass-card-static p-6">
          <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Tendência Mensal</h2>
          {monthlyData.some((m) => m.income > 0 || m.expense > 0) ? (
            <div className="chart-container">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                  <XAxis dataKey="month" stroke="var(--text-muted)" fontSize={12} />
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
                  <Bar dataKey="income" fill="#10B981" radius={[4, 4, 0, 0]} name="Receita" />
                  <Bar dataKey="expense" fill="#EF4444" radius={[4, 4, 0, 0]} name="Despesa" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>
              Sem dados ainda
            </div>
          )}
        </div>
      </div>

      {/* AI Insights */}
      {insights.length > 0 && (
        <div
          className="glass-card-static p-6"
          style={{ borderLeft: '3px solid #7C3AED' }}
        >
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-5 h-5" style={{ color: '#a78bfa', filter: 'drop-shadow(0 0 6px rgba(124, 58, 237, 0.4))' }} />
            <h2 className="text-lg font-semibold gradient-text">Insights da IA</h2>
          </div>
          <div className="space-y-3">
            {insights.map((insight) => (
              <div
                key={insight.id}
                className="p-4 rounded-xl flex items-start gap-3"
                style={{
                  background: insight.type === 'warning'
                    ? 'rgba(245, 158, 11, 0.08)'
                    : insight.type === 'tip'
                    ? 'rgba(16, 185, 129, 0.08)'
                    : 'rgba(124, 58, 237, 0.08)',
                  border: `1px solid ${
                    insight.type === 'warning'
                      ? 'rgba(245, 158, 11, 0.15)'
                      : insight.type === 'tip'
                      ? 'rgba(16, 185, 129, 0.15)'
                      : 'rgba(124, 58, 237, 0.15)'
                  }`,
                }}
              >
                {insight.type === 'warning' && <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />}
                {insight.type === 'tip' && <Lightbulb className="w-5 h-5 text-green-400 flex-shrink-0" />}
                {insight.type === 'info' && <Sparkles className="w-5 h-5 flex-shrink-0" style={{ color: '#a78bfa' }} />}
                <div>
                  <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{insight.title}</p>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{insight.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Transactions */}
      <div className="glass-card-static p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Transações Recentes</h2>
          <Link
            href="/transactions"
            className="text-sm font-medium transition-colors"
            style={{ color: '#a78bfa' }}
          >
            Ver Todas
          </Link>
        </div>
        {recentTransactions.length > 0 ? (
          <div className="space-y-2 stagger-children">
            {recentTransactions.map((transaction) => {
              const cat = getCategoryInfo(transaction.category);
              return (
                <div
                  key={transaction.id}
                  className="flex items-center justify-between p-3 rounded-xl transition-all duration-200"
                  style={{
                    background: 'transparent',
                    cursor: 'default',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--hover-bg)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-lg"
                      style={{ backgroundColor: `${cat.color}18` }}
                    >
                      {cat.icon}
                    </div>
                    <div>
                      <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{transaction.description}</p>
                      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                        {new Date(transaction.date).toLocaleDateString('pt-BR', {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`font-semibold ${
                      transaction.type === 'income' ? 'text-green-400' : 'text-red-400'
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
          <div className="text-center py-8" style={{ color: 'var(--text-muted)' }}>
            <p>Nenhuma transação ainda</p>
            <Link href="/add" className="font-medium mt-2 inline-block" style={{ color: '#a78bfa' }}>
              Adicione sua primeira transação
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
