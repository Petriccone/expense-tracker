'use client';

import { useState } from 'react';
import { Save, Download, Trash2, Moon, Sun, Euro, DollarSign, Ban } from 'lucide-react';
import { useSettings } from '@/context/AppContext';

export default function SettingsPage() {
  const { settings, setSettings } = useSettings();
  const [form, setForm] = useState(settings);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSettings(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleExport = () => {
    const data = localStorage.getItem('expense-tracker-data');
    if (!data) {
      alert('No data to export');
      return;
    }
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `expense-tracker-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClearData = () => {
    if (confirm('Are you sure you want to delete ALL data? This cannot be undone!')) {
      if (confirm('Really? All your transactions will be permanently deleted.')) {
        localStorage.removeItem('expense-tracker-data');
        window.location.reload();
      }
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fadeIn">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-slate-900">Settings</h1>
        <p className="text-slate-500">Customize your experience</p>
      </div>

      {/* Currency */}
      <div className="bg-white rounded-2xl p-6 shadow-sm">
        <h2 className="text-lg font-semibold mb-4">Currency</h2>
        <div className="grid grid-cols-3 gap-3">
          {[
            { value: 'EUR', label: 'Euro', icon: Euro, symbol: '€' },
            { value: 'USD', label: 'US Dollar', icon: DollarSign, symbol: '$' },
            { value: 'BRL', label: 'Real', icon: Ban, symbol: 'R$' },
          ].map((curr) => (
            <button
              key={curr.value}
              onClick={() => setForm({ ...form, currency: curr.value })}
              className={`p-4 rounded-xl border-2 transition-all ${
                form.currency === curr.value
                  ? 'border-purple-500 bg-purple-50'
                  : 'border-slate-200 hover:border-purple-200'
              }`}
            >
              <div className="text-2xl mb-1">{curr.symbol}</div>
              <div className="text-sm font-medium">{curr.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Monthly Budget */}
      <div className="bg-white rounded-2xl p-6 shadow-sm">
        <h2 className="text-lg font-semibold mb-4">Monthly Budget</h2>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Monthly Expense Limit
          </label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
              {form.currency === 'EUR' ? '€' : form.currency === 'USD' ? '$' : 'R$'}
            </span>
            <input
              type="number"
              min="0"
              step="100"
              value={form.monthlyBudget}
              onChange={(e) => setForm({ ...form, monthlyBudget: parseFloat(e.target.value) || 0 })}
              className="input-field pl-10"
            />
          </div>
          <p className="text-sm text-slate-500 mt-2">
            Set a limit to get budget warnings when approaching or exceeding it.
          </p>
        </div>
      </div>

      {/* Appearance */}
      <div className="bg-white rounded-2xl p-6 shadow-sm">
        <h2 className="text-lg font-semibold mb-4">Appearance</h2>
        <button
          onClick={() => setForm({ ...form, darkMode: !form.darkMode })}
          className="w-full flex items-center justify-between p-4 rounded-xl border border-slate-200 hover:border-purple-200 transition-colors"
        >
          <div className="flex items-center gap-3">
            {form.darkMode ? (
              <Moon className="w-5 h-5 text-purple-600" />
            ) : (
              <Sun className="w-5 h-5 text-purple-600" />
            )}
            <div className="text-left">
              <p className="font-medium">Dark Mode</p>
              <p className="text-sm text-slate-500">
                {form.darkMode ? 'Currently using dark theme' : 'Currently using light theme'}
              </p>
            </div>
          </div>
          <div className={`w-12 h-6 rounded-full transition-colors ${
            form.darkMode ? 'bg-purple-500' : 'bg-slate-200'
          }`}>
            <div className={`w-5 h-5 bg-white rounded-full shadow transform transition-transform ${
              form.darkMode ? 'translate-x-6' : 'translate-x-0.5'
            } mt-0.5`} />
          </div>
        </button>
      </div>

      {/* Data Management */}
      <div className="bg-white rounded-2xl p-6 shadow-sm">
        <h2 className="text-lg font-semibold mb-4">Data Management</h2>
        <div className="space-y-3">
          <button
            onClick={handleExport}
            className="w-full flex items-center gap-3 p-4 rounded-xl border border-slate-200 hover:border-purple-200 transition-colors"
          >
            <Download className="w-5 h-5 text-purple-600" />
            <div className="text-left">
              <p className="font-medium">Export Data</p>
              <p className="text-sm text-slate-500">Download all your data as JSON</p>
            </div>
          </button>
          <button
            onClick={handleClearData}
            className="w-full flex items-center gap-3 p-4 rounded-xl border border-red-200 hover:border-red-300 hover:bg-red-50 transition-colors"
          >
            <Trash2 className="w-5 h-5 text-red-600" />
            <div className="text-left">
              <p className="font-medium text-red-600">Clear All Data</p>
              <p className="text-sm text-red-400">Permanently delete all transactions</p>
            </div>
          </button>
        </div>
      </div>

      {/* Save Button */}
      <button
        onClick={handleSave}
        className="btn-primary w-full py-4 flex items-center justify-center gap-2"
      >
        <Save className="w-5 h-5" />
        {saved ? 'Saved!' : 'Save Settings'}
      </button>

      {/* Version Info */}
      <div className="text-center text-sm text-slate-400">
        <p>ExpenseTracker AI v1.0.0</p>
        <p>Built with Next.js + Tailwind CSS</p>
      </div>
    </div>
  );
}