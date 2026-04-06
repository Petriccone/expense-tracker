'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  Plus,
  Search,
  Filter,
  Edit2,
  Trash2,
  X,
  ChevronDown,
} from 'lucide-react';
import { useTransactions, useCategories, useSettings } from '@/context/AppContext';
import { Transaction } from '@/types';

export default function TransactionsPage() {
  const { transactions, updateTransaction, deleteTransaction } = useTransactions();
  const { categories } = useCategories();
  const { settings } = useSettings();

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');
  const [monthFilter, setMonthFilter] = useState('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Transaction>>({});

  const currencySymbol = settings.currency === 'EUR' ? '€' : settings.currency === 'USD' ? '$' : 'R$';

  const formatAmount = (amount: number) => {
    return `${currencySymbol}${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const filteredTransactions = useMemo(() => {
    return transactions.filter((t) => {
      // Search
      if (search && !t.description.toLowerCase().includes(search.toLowerCase())) {
        return false;
      }
      // Type filter
      if (typeFilter !== 'all' && t.type !== typeFilter) {
        return false;
      }
      // Category filter
      if (categoryFilter !== 'all' && t.category !== categoryFilter) {
        return false;
      }
      // Date filter
      if (dateFilter !== 'all') {
        const now = new Date();
        const tDate = new Date(t.date);
        if (dateFilter === 'today') {
          if (tDate.toDateString() !== now.toDateString()) return false;
        } else if (dateFilter === 'week') {
          const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          if (tDate < weekAgo) return false;
        } else if (dateFilter === 'month') {
          if (tDate.getMonth() !== now.getMonth() || tDate.getFullYear() !== now.getFullYear()) {
            return false;
          }
        }
      }
      // Month filter (specific month)
      if (monthFilter !== 'all') {
        const tDate = new Date(t.date);
        const tMonth = `${tDate.getFullYear()}-${String(tDate.getMonth() + 1).padStart(2, '0')}`;
        if (tMonth !== monthFilter) return false;
      }
      return true;
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [transactions, search, typeFilter, categoryFilter, dateFilter, monthFilter]);

  const getCategoryInfo = (categoryName: string) => {
    return categories.find((c) => c.name === categoryName) || { icon: '📦', color: '#64748B' };
  };

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this transaction?')) {
      deleteTransaction(id);
    }
  };

  const uniqueCategories = [...new Set(transactions.map((t) => t.category))];

  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    transactions.forEach((t) => {
      const d = new Date(t.date);
      months.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    });
    return [...months].sort().reverse();
  }, [transactions]);

  const formatMonthLabel = (key: string) => {
    const [year, month] = key.split('-');
    const d = new Date(parseInt(year), parseInt(month) - 1);
    return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900">Transactions</h1>
          <p className="text-slate-500">{transactions.length} total transactions</p>
        </div>
        <Link href="/add" className="btn-primary flex items-center gap-2 justify-center w-fit">
          <Plus className="w-5 h-5" />
          Add Transaction
        </Link>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl p-4 shadow-sm">
        <div className="flex flex-col md:flex-row gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              placeholder="Search transactions..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-field pl-10"
            />
          </div>

          {/* Type Filter */}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as any)}
            className="select-field md:w-40"
          >
            <option value="all">All Types</option>
            <option value="income">Income</option>
            <option value="expense">Expense</option>
          </select>

          {/* Category Filter */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="select-field md:w-48"
          >
            <option value="all">All Categories</option>
            {uniqueCategories.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>

          {/* Date Filter */}
          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="select-field md:w-40"
          >
            <option value="all">All Time</option>
            <option value="today">Today</option>
            <option value="week">This Week</option>
            <option value="month">This Month</option>
          </select>

          {/* Month Filter */}
          <select
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            className="select-field md:w-48"
          >
            <option value="all">All Months</option>
            {availableMonths.map((m) => (
              <option key={m} value={m}>{formatMonthLabel(m)}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Transactions List */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        {filteredTransactions.length > 0 ? (
          <div className="divide-y divide-slate-100">
            {filteredTransactions.map((transaction) => {
              const cat = getCategoryInfo(transaction.category);
              return (
                <div
                  key={transaction.id}
                  className="flex items-center justify-between p-4 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center text-xl"
                      style={{ backgroundColor: `${cat.color}20` }}
                    >
                      {cat.icon}
                    </div>
                    <div>
                      <p className="font-medium text-slate-900">{transaction.description}</p>
                      <div className="flex items-center gap-2 text-sm text-slate-500">
                        <span>{transaction.category}</span>
                        <span>•</span>
                        <span>
                          {new Date(transaction.date).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span
                      className={`text-lg font-semibold ${
                        transaction.type === 'income' ? 'text-green-600' : 'text-red-600'
                      }`}
                    >
                      {transaction.type === 'income' ? '+' : '-'}
                      {formatAmount(transaction.amount)}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          setEditingId(transaction.id);
                          setEditForm(transaction);
                        }}
                        className="p-2 text-slate-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(transaction.id)}
                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-12 text-slate-400">
            <p className="text-lg">No transactions found</p>
            <p className="text-sm mt-1">Try adjusting your filters</p>
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {editingId && editForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Edit Transaction</h2>
              <button
                onClick={() => setEditingId(null)}
                className="p-2 hover:bg-slate-100 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                <input
                  type="text"
                  value={editForm.description || ''}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Amount</label>
                <input
                  type="number"
                  step="0.01"
                  value={editForm.amount || 0}
                  onChange={(e) => setEditForm({ ...editForm, amount: parseFloat(e.target.value) })}
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
                <select
                  value={editForm.type || 'expense'}
                  onChange={(e) => setEditForm({ ...editForm, type: e.target.value as 'income' | 'expense' })}
                  className="select-field"
                >
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
                <select
                  value={editForm.category || ''}
                  onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                  className="select-field"
                >
                  {categories.filter((cat) => cat.type === editForm.type).map((cat) => (
                    <option key={cat.id} value={cat.name}>{cat.icon} {cat.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
                <input
                  type="date"
                  value={editForm.date || ''}
                  onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
                  className="input-field"
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setEditingId(null)}
                  className="btn-secondary flex-1"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (editForm.description && editForm.amount && editForm.category && editForm.date && editForm.type) {
                      updateTransaction({
                        ...editForm,
                        id: editingId,
                      } as Transaction);
                    }
                    setEditingId(null);
                  }}
                  className="btn-primary flex-1"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}