'use client';

import { useState, useRef, useEffect } from 'react';
import { Upload, FileSpreadsheet, Loader2, Check, AlertCircle, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useTransactions, useSettings } from '@/context/AppContext';
import { Transaction } from '@/types';

export default function ImportPage() {
  const { addTransaction } = useTransactions();
  const { settings } = useSettings();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [preview, setPreview] = useState<Transaction[]>([]);
  const [token, setToken] = useState('');
  const [mounted, setMounted] = useState(false);

  // Check for token on mount (client-side only)
  useEffect(() => {
    setMounted(true);
    const storedToken = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : '';
    if (storedToken) setToken(storedToken);
  }, []);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const storedToken = localStorage.getItem('auth_token');
    if (!storedToken) {
      setError('You need to be logged in to import data');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess(false);
    setPreview([]);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${storedToken}`,
        },
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to import');
        return;
      }

      setPreview(data.transactions);
      setSuccess(true);
    } catch (err) {
      setError('Failed to upload file');
    } finally {
      setLoading(false);
    }
  };

  const handleImport = () => {
    preview.forEach((t) => addTransaction(t));
    setPreview([]);
    setSuccess(false);
    alert(`Successfully imported ${preview.length} transactions!`);
  };

  const currencySymbol = settings.currency === 'EUR' ? '€' : settings.currency === 'USD' ? '$' : 'R$';

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="max-w-2xl mx-auto animate-fadeIn">
        <div className="bg-white rounded-2xl p-8 shadow-sm text-center">
          <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Login Required</h2>
          <p className="text-slate-500 mb-4">You need to be logged in to import data.</p>
          <Link href="/login" className="btn-primary">
            Go to Login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Link href="/" className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900">Import Data</h1>
          <p className="text-slate-500">Upload your expense spreadsheet</p>
        </div>
      </div>

      {/* Upload Area */}
      <div className="bg-white rounded-2xl p-8 shadow-sm">
        <div
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center cursor-pointer hover:border-purple-400 hover:bg-purple-50/50 transition-all"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileSelect}
            className="hidden"
          />

          {loading ? (
            <div className="py-8">
              <Loader2 className="w-12 h-12 text-purple-600 mx-auto animate-spin" />
              <p className="mt-4 text-slate-600">Processing your file...</p>
            </div>
          ) : (
            <>
              <FileSpreadsheet className="w-12 h-12 text-purple-600 mx-auto mb-4" />
              <p className="text-lg font-medium text-slate-700">
                Click to upload your spreadsheet
              </p>
              <p className="text-sm text-slate-500 mt-2">
                Supports .xlsx, .xls, and .csv files
              </p>
            </>
          )}
        </div>

        {error && (
          <div className="mt-4 bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        {success && preview.length > 0 && (
          <div className="mt-4 bg-green-50 text-green-600 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
            <Check className="w-4 h-4" />
            Found {preview.length} transactions to import
          </div>
        )}
      </div>

      {/* Preview */}
      {preview.length > 0 && (
        <div className="bg-white rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Preview</h2>
            <button onClick={handleImport} className="btn-primary">
              Import All ({preview.length})
            </button>
          </div>

          <div className="space-y-2 max-h-64 overflow-y-auto">
            {preview.slice(0, 10).map((t, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <div>
                  <p className="font-medium text-slate-800">{t.description}</p>
                  <p className="text-sm text-slate-500">{t.date} • {t.category}</p>
                </div>
                <span className={t.type === 'income' ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                  {t.type === 'income' ? '+' : '-'}{currencySymbol}{t.amount.toFixed(2)}
                </span>
              </div>
            ))}
            {preview.length > 10 && (
              <p className="text-center text-slate-500 text-sm py-2">
                ...and {preview.length - 10} more
              </p>
            )}
          </div>
        </div>
      )}

      {/* Instructions */}
      <div className="bg-white rounded-2xl p-6 shadow-sm">
        <h2 className="text-lg font-semibold mb-4">Spreadsheet Format</h2>
        <p className="text-slate-600 text-sm mb-4">
          Your spreadsheet should have columns like:
        </p>
        <div className="bg-slate-50 rounded-xl p-4 text-sm font-mono">
          <div className="grid grid-cols-4 gap-2 text-slate-600 mb-2 font-semibold">
            <span>Date</span>
            <span>Description</span>
            <span>Amount</span>
            <span>Category</span>
          </div>
          <div className="grid grid-cols-4 gap-2 text-slate-500">
            <span>2026-04-03</span>
            <span>Supermarket</span>
            <span>45.50</span>
            <span>Food</span>
          </div>
          <div className="grid grid-cols-4 gap-2 text-slate-500">
            <span>2026-04-02</span>
            <span>Uber</span>
            <span>15.00</span>
            <span>Transport</span>
          </div>
        </div>
        <p className="text-slate-500 text-xs mt-4">
          The system will try to auto-detect your column names. Common variations like "Valor", "Montante", "Descrição" are supported.
        </p>
      </div>
    </div>
  );
}