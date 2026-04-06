'use client';

import { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import {
  Plus,
  Search,
  Filter,
  Edit2,
  Trash2,
  X,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
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
  const [dayFilter, setDayFilter] = useState('');
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Transaction>>({});

  const navigateMonth = (dir: number) => {
    setSelectedMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + dir, 1));
  };
  const monthLabel = selectedMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).replace(/^\w/, c => c.toUpperCase());
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalRoot(document.body);
  }, []);

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
      // Day filter (exact date match)
      if (dayFilter) {
        if (t.date !== dayFilter) return false;
      } else {
        // Month filter (only when no day filter)
        const tDate = new Date(t.date);
        if (tDate.getMonth() !== selectedMonth.getMonth() || tDate.getFullYear() !== selectedMonth.getFullYear()) {
          return false;
        }
      }
      return true;
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [transactions, search, typeFilter, categoryFilter, selectedMonth, dayFilter]);

  const getCategoryInfo = (categoryName: string) => {
    return categories.find((c) => c.name === categoryName) || { icon: '📦', color: '#64748B' };
  };

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this transaction?')) {
      deleteTransaction(id);
    }
  };

  const uniqueCategories = [...new Set(transactions.map((t) => t.category))];


  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold gradient-text">Transactions</h1>
          <p style={{ color: 'var(--text-secondary)' }}>{filteredTransactions.length} transactions</p>
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
          <Link href="/add" className="btn-primary flex items-center gap-2 justify-center">
            <Plus className="w-5 h-5" />
            <span className="hidden md:inline">Add Transaction</span>
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="glass-card-static p-4">
        <div className="flex flex-col gap-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Search transactions..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-field pl-10"
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {/* Type Filter */}
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as any)}
              className="select-field"
            >
              <option value="all">All Types</option>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
            </select>

            {/* Category Filter */}
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="select-field"
            >
              <option value="all">All Categories</option>
              {uniqueCategories.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>

            {/* Day Filter */}
            <div className="relative col-span-2 md:col-span-2 flex gap-2">
              <input
                type="date"
                value={dayFilter}
                onChange={(e) => setDayFilter(e.target.value)}
                className="input-field flex-1"
                style={{ colorScheme: 'dark' }}
              />
              {dayFilter && (
                <button
                  onClick={() => setDayFilter('')}
                  className="px-3 rounded-lg transition-colors flex items-center"
                  style={{ color: 'var(--text-muted)', background: 'var(--bg-input)' }}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Transactions List */}
      <div className="glass-card-static overflow-hidden">
        {filteredTransactions.length > 0 ? (
          <div style={{ borderColor: 'var(--border-color)' }}>
            {filteredTransactions.map((transaction, index) => {
              const cat = getCategoryInfo(transaction.category);
              return (
                <div
                  key={transaction.id}
                  className="flex items-center justify-between p-4 transition-all duration-200"
                  style={{
                    borderBottom: index < filteredTransactions.length - 1 ? '1px solid var(--border-color)' : 'none',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover-bg)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <div className="flex items-center gap-4">
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center text-xl"
                      style={{ backgroundColor: `${cat.color}18` }}
                    >
                      {cat.icon}
                    </div>
                    <div>
                      <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{transaction.description}</p>
                      <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
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
                        transaction.type === 'income' ? 'text-green-400' : 'text-red-400'
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
                        className="p-2 rounded-lg transition-all"
                        style={{ color: 'var(--text-muted)' }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = '#a78bfa'; e.currentTarget.style.background = 'rgba(124, 58, 237, 0.1)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = '#5a6478'; e.currentTarget.style.background = 'transparent'; }}
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(transaction.id)}
                        className="p-2 rounded-lg transition-all"
                        style={{ color: 'var(--text-muted)' }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = '#f87171'; e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = '#5a6478'; e.currentTarget.style.background = 'transparent'; }}
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
          <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
            <p className="text-lg">No transactions found</p>
            <p className="text-sm mt-1">Try adjusting your filters</p>
          </div>
        )}
      </div>

      {/* Edit Modal - rendered via portal to escape stacking context */}
      {editingId && editForm && portalRoot && createPortal(
        <div
          className="fixed inset-0 flex items-center justify-center p-4"
          style={{ background: 'var(--modal-overlay)', backdropFilter: 'blur(8px)', zIndex: 9999 }}
          onClick={(e) => { if (e.target === e.currentTarget) setEditingId(null); }}
        >
          <div
            className="glass-strong p-6 w-full max-w-md animate-slideUp"
            style={{
              boxShadow: '0 16px 64px rgba(0, 0, 0, 0.5), 0 0 40px rgba(124, 58, 237, 0.1)',
            }}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>Edit Transaction</h2>
              <button
                onClick={() => setEditingId(null)}
                className="p-2 rounded-lg transition-colors"
                style={{ color: 'var(--text-muted)' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover-bg)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Description</label>
                <input
                  type="text"
                  value={editForm.description || ''}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Amount</label>
                <input
                  type="number"
                  step="0.01"
                  value={editForm.amount || 0}
                  onChange={(e) => setEditForm({ ...editForm, amount: parseFloat(e.target.value) })}
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Type</label>
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
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Category</label>
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
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Date</label>
                <input
                  type="date"
                  value={editForm.date || ''}
                  onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
                  className="input-field"
                  style={{ colorScheme: 'var(--color-scheme)' }}
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
        </div>,
        portalRoot
      )}
    </div>
  );
}
