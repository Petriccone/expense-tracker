'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Sparkles, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useTransactions, useCategories, useSettings } from '@/context/AppContext';
import { Transaction } from '@/types';

export default function AddTransactionPage() {
  const router = useRouter();
  const { addTransaction } = useTransactions();
  const { categories } = useCategories();
  const { settings } = useSettings();

  const [form, setForm] = useState({
    type: 'expense' as 'income' | 'expense',
    amount: '',
    description: '',
    category: '',
    date: new Date().toISOString().split('T')[0],
    notes: '',
  });

  const [isCategorizing, setIsCategorizing] = useState(false);
  const [aiSuggestedCategory, setAiSuggestedCategory] = useState('');

  const currencySymbol = settings.currency === 'EUR' ? '€' : settings.currency === 'USD' ? '$' : 'R$';

  const expenseCategories = categories.filter((c) => c.type === 'expense');
  const incomeCategories = categories.filter((c) => c.type === 'income');
  const availableCategories = form.type === 'expense' ? expenseCategories : incomeCategories;

  // AI Auto-categorization (simulated for demo)
  const handleAIAutoCategorize = async () => {
    if (!form.description.trim()) {
      alert('Please enter a description first');
      return;
    }

    setIsCategorizing(true);

    // Simulate AI categorization with a delay
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const desc = form.description.toLowerCase();
    let suggested = '';

    // Simple keyword-based categorization (simulating AI)
    if (desc.includes('food') || desc.includes('restaurant') || desc.includes('lunch') || desc.includes('dinner') || desc.includes('breakfast') || desc.includes('coffee') || desc.includes('pizza') || desc.includes('burger')) {
      suggested = 'Food & Dining';
    } else if (desc.includes('uber') || desc.includes('taxi') || desc.includes('bus') || desc.includes('metro') || desc.includes('train') || desc.includes('fuel') || desc.includes('gas') || desc.includes('parking')) {
      suggested = 'Transport';
    } else if (desc.includes('rent') || desc.includes('mortgage') || desc.includes('electricity') || desc.includes('water') || desc.includes('internet') || desc.includes('phone') || desc.includes('utilities')) {
      suggested = 'Housing';
    } else if (desc.includes('movie') || desc.includes('netflix') || desc.includes('spotify') || desc.includes('game') || desc.includes('concert') || desc.includes('party')) {
      suggested = 'Entertainment';
    } else if (desc.includes('shop') || desc.includes('amazon') || desc.includes('clothes') || desc.includes('shoes') || desc.includes('gift')) {
      suggested = 'Shopping';
    } else if (desc.includes('doctor') || desc.includes('hospital') || desc.includes('pharmacy') || desc.includes('medicine') || desc.includes('health') || desc.includes('gym')) {
      suggested = 'Health';
    } else if (desc.includes('book') || desc.includes('course') || desc.includes('school') || desc.includes('university') || desc.includes(' tuition')) {
      suggested = 'Education';
    } else if (desc.includes('bill') || desc.includes('subscription') || desc.includes('insurance')) {
      suggested = 'Bills & Utilities';
    } else if (desc.includes('salary') || desc.includes('payroll') || desc.includes('payday')) {
      suggested = 'Salary';
    } else if (desc.includes('freelance') || desc.includes('client') || desc.includes('project')) {
      suggested = 'Freelance';
    } else if (desc.includes('dividend') || desc.includes('interest') || desc.includes('stock') || desc.includes('crypto')) {
      suggested = 'Investment';
    } else {
      suggested = 'Other';
    }

    setAiSuggestedCategory(suggested);
    setForm((f) => ({ ...f, category: suggested }));
    setIsCategorizing(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.amount || !form.description || !form.category) {
      alert('Please fill in all required fields');
      return;
    }

    const transaction: Transaction = {
      id: Date.now().toString(),
      type: form.type,
      amount: parseFloat(form.amount),
      description: form.description,
      category: form.category,
      date: form.date,
      notes: form.notes,
      createdAt: new Date().toISOString(),
    };

    addTransaction(transaction);
    router.push('/');
  };

  return (
    <div className="max-w-2xl mx-auto animate-fadeIn">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Link
          href="/"
          className="p-2 rounded-xl transition-all"
          style={{ color: 'var(--text-secondary)' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover-bg)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl md:text-3xl font-bold gradient-text">Add Transaction</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Record a new expense or income</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Type Toggle */}
        <div className="glass-card-static p-2 flex">
          <button
            type="button"
            onClick={() => setForm({ ...form, type: 'expense', category: '' })}
            className="flex-1 py-3 rounded-xl font-medium transition-all"
            style={{
              background: form.type === 'expense'
                ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.2), rgba(239, 68, 68, 0.1))'
                : 'transparent',
              color: form.type === 'expense' ? '#f87171' : '#5a6478',
              border: form.type === 'expense' ? '1px solid rgba(239, 68, 68, 0.2)' : '1px solid transparent',
              boxShadow: form.type === 'expense' ? '0 0 15px rgba(239, 68, 68, 0.1)' : 'none',
              cursor: 'pointer',
            }}
          >
            Expense
          </button>
          <button
            type="button"
            onClick={() => setForm({ ...form, type: 'income', category: '' })}
            className="flex-1 py-3 rounded-xl font-medium transition-all"
            style={{
              background: form.type === 'income'
                ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(16, 185, 129, 0.1))'
                : 'transparent',
              color: form.type === 'income' ? '#34d399' : '#5a6478',
              border: form.type === 'income' ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid transparent',
              boxShadow: form.type === 'income' ? '0 0 15px rgba(16, 185, 129, 0.1)' : 'none',
              cursor: 'pointer',
            }}
          >
            Income
          </button>
        </div>

        {/* Amount */}
        <div className="glass-card-static p-6">
          <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Amount</label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl" style={{ color: 'var(--text-muted)' }}>
              {currencySymbol}
            </span>
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              className="input-field text-3xl font-bold pl-12 h-16"
              required
            />
          </div>
        </div>

        {/* Description */}
        <div className="glass-card-static p-6">
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Description</label>
            <button
              type="button"
              onClick={handleAIAutoCategorize}
              disabled={isCategorizing}
              className="flex items-center gap-1 text-sm font-medium disabled:opacity-50 transition-colors"
              style={{ color: '#a78bfa', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              {isCategorizing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" style={{ filter: 'drop-shadow(0 0 4px rgba(124, 58, 237, 0.4))' }} />
              )}
              AI Auto-Categorize
            </button>
          </div>
          <input
            type="text"
            placeholder="What was this for?"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="input-field"
            required
          />
          {aiSuggestedCategory && (
            <p className="text-sm mt-2 flex items-center gap-1" style={{ color: '#a78bfa' }}>
              <Sparkles className="w-4 h-4" />
              AI suggested: {aiSuggestedCategory}
            </p>
          )}
        </div>

        {/* Category */}
        <div className="glass-card-static p-6">
          <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Category</label>
          <select
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="select-field"
            required
          >
            <option value="">Select a category</option>
            {availableCategories.map((cat) => (
              <option key={cat.id} value={cat.name}>
                {cat.icon} {cat.name}
              </option>
            ))}
          </select>
        </div>

        {/* Date */}
        <div className="glass-card-static p-6">
          <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Date</label>
          <input
            type="date"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
            className="input-field"
            required
          />
        </div>

        {/* Notes */}
        <div className="glass-card-static p-6">
          <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Notes (optional)</label>
          <textarea
            rows={3}
            placeholder="Any additional details..."
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className="input-field resize-none"
            style={{ height: 'auto', padding: '12px 16px' }}
          />
        </div>

        {/* Submit */}
        <button type="submit" className="btn-primary w-full py-4 text-lg">
          Add Transaction
        </button>
      </form>
    </div>
  );
}
