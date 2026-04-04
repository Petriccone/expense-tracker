'use client';

import { useState, useRef, useEffect } from 'react';
import { Upload, FileSpreadsheet, Loader2, Check, AlertCircle, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useTransactions, useSettings } from '@/context/AppContext';
import { Transaction } from '@/types';

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',' || ch === ';') {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function guessCategory(description: string): string {
  const desc = description.toLowerCase();
  if (/food|restaurant|lunch|dinner|breakfast|coffee|pizza|burger|supermarket/.test(desc)) return 'Food & Dining';
  if (/uber|taxi|bus|metro|train|fuel|gas|parking/.test(desc)) return 'Transport';
  if (/rent|mortgage|electricity|water|internet|phone/.test(desc)) return 'Housing';
  if (/movie|netflix|spotify|game|concert/.test(desc)) return 'Entertainment';
  if (/shop|amazon|clothes|shoes/.test(desc)) return 'Shopping';
  if (/doctor|hospital|pharmacy|medicine|gym/.test(desc)) return 'Health';
  if (/book|course|school|university/.test(desc)) return 'Education';
  if (/bill|subscription|insurance/.test(desc)) return 'Bills & Utilities';
  if (/salary|payroll/.test(desc)) return 'Salary';
  if (/freelance|client/.test(desc)) return 'Freelance';
  return 'Other';
}

function parseAmount(val: string): number {
  const cleaned = val.replace(/[^\d.,-]/g, '').replace(',', '.');
  return Math.abs(parseFloat(cleaned) || 0);
}

function parseTransactionsFromCSV(text: string): Transaction[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase());

  const dateIdx = headers.findIndex((h) => /^(date|data|dia)$/.test(h));
  const descIdx = headers.findIndex((h) => /^(description|descri|nome|what)/.test(h));
  const amountIdx = headers.findIndex((h) => /^(amount|valor|value|montante)$/.test(h));
  const categoryIdx = headers.findIndex((h) => /^(category|categoria)$/.test(h));
  const typeIdx = headers.findIndex((h) => /^(type|tipo)$/.test(h));

  if (descIdx === -1 && amountIdx === -1) return [];

  const transactions: Transaction[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < 2) continue;

    const description = descIdx >= 0 ? cols[descIdx] : cols[0];
    const amountStr = amountIdx >= 0 ? cols[amountIdx] : cols[1];
    const amount = parseAmount(amountStr || '0');
    if (!description || amount === 0) continue;

    const rawType = typeIdx >= 0 ? cols[typeIdx]?.toLowerCase() : '';
    const type: 'income' | 'expense' = rawType.includes('income') || rawType.includes('receita')
      ? 'income'
      : amountStr?.startsWith('-') ? 'expense' : 'expense';

    const category = categoryIdx >= 0 && cols[categoryIdx] ? cols[categoryIdx] : guessCategory(description);
    const date = dateIdx >= 0 && cols[dateIdx] ? cols[dateIdx] : new Date().toISOString().split('T')[0];

    transactions.push({
      id: `import_${Date.now()}_${i}`,
      type,
      amount,
      description,
      category,
      date,
      createdAt: new Date().toISOString(),
    });
  }
  return transactions;
}

export default function ImportPage() {
  const { addTransaction } = useTransactions();
  const { settings } = useSettings();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [preview, setPreview] = useState<Transaction[]>([]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError('');
    setSuccess(false);
    setPreview([]);

    try {
      const text = await file.text();
      const transactions = parseTransactionsFromCSV(text);

      if (transactions.length === 0) {
        setError('No transactions found in file. Check the format.');
        return;
      }

      setPreview(transactions);
      setSuccess(true);
    } catch (err) {
      setError('Failed to parse file');
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
            accept=".csv"
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
              <p className="text-lg font-medium text-slate-700">Click to upload your spreadsheet</p>
              <p className="text-sm text-slate-500 mt-2">Supports .csv files</p>
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
                  <p className="text-sm text-slate-500">{t.date} - {t.category}</p>
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
        <h2 className="text-lg font-semibold mb-4">CSV Format</h2>
        <p className="text-slate-600 text-sm mb-4">Your CSV should have columns like:</p>
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
        </div>
      </div>
    </div>
  );
}
