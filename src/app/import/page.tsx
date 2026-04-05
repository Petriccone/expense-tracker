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
        setError('Nenhuma transação encontrada no arquivo. Verifique o formato.');
        return;
      }

      setPreview(transactions);
      setSuccess(true);
    } catch (err) {
      setError('Falha ao processar o arquivo');
    } finally {
      setLoading(false);
    }
  };

  const handleImport = () => {
    preview.forEach((t) => addTransaction(t));
    setPreview([]);
    setSuccess(false);
    alert(`${preview.length} transações importadas com sucesso!`);
  };

  const currencySymbol = settings.currency === 'EUR' ? '€' : settings.currency === 'USD' ? '$' : 'R$';

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fadeIn">
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
          <h1 className="text-2xl md:text-3xl font-bold gradient-text">Importar Dados</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Envie sua planilha de despesas</p>
        </div>
      </div>

      {/* Upload Area */}
      <div className="glass-card-static p-8">
        <div
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all"
          style={{ borderColor: 'var(--dashed-border)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'rgba(124, 58, 237, 0.3)';
            e.currentTarget.style.background = 'rgba(124, 58, 237, 0.04)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
            e.currentTarget.style.background = 'transparent';
          }}
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
              <Loader2 className="w-12 h-12 mx-auto animate-spin" style={{ color: '#a78bfa' }} />
              <p className="mt-4" style={{ color: 'var(--text-secondary)' }}>Processando seu arquivo...</p>
            </div>
          ) : (
            <>
              <FileSpreadsheet className="w-12 h-12 mx-auto mb-4" style={{ color: '#a78bfa', filter: 'drop-shadow(0 0 8px rgba(124, 58, 237, 0.3))' }} />
              <p className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>Clique para enviar sua planilha</p>
              <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>Suporta arquivos .csv</p>
            </>
          )}
        </div>

        {error && (
          <div
            className="mt-4 px-4 py-3 rounded-xl text-sm flex items-center gap-2"
            style={{
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.15)',
              color: '#f87171',
            }}
          >
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        {success && preview.length > 0 && (
          <div
            className="mt-4 px-4 py-3 rounded-xl text-sm flex items-center gap-2"
            style={{
              background: 'rgba(16, 185, 129, 0.08)',
              border: '1px solid rgba(16, 185, 129, 0.15)',
              color: '#34d399',
            }}
          >
            <Check className="w-4 h-4" />
            {preview.length} transações encontradas para importar
          </div>
        )}
      </div>

      {/* Preview */}
      {preview.length > 0 && (
        <div className="glass-card-static p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Pré-visualização</h2>
            <button onClick={handleImport} className="btn-primary">
              Importar Todas ({preview.length})
            </button>
          </div>

          <div className="space-y-2 max-h-64 overflow-y-auto">
            {preview.slice(0, 10).map((t, i) => (
              <div
                key={i}
                className="flex items-center justify-between p-3 rounded-lg"
                style={{ background: 'var(--bg-input)' }}
              >
                <div>
                  <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{t.description}</p>
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t.date} - {t.category}</p>
                </div>
                <span className={t.type === 'income' ? 'text-green-400 font-medium' : 'text-red-400 font-medium'}>
                  {t.type === 'income' ? '+' : '-'}{currencySymbol}{t.amount.toFixed(2)}
                </span>
              </div>
            ))}
            {preview.length > 10 && (
              <p className="text-center text-sm py-2" style={{ color: 'var(--text-muted)' }}>
                ...e mais {preview.length - 10}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Instructions */}
      <div className="glass-card-static p-6">
        <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Formato CSV</h2>
        <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>Seu CSV deve ter colunas como:</p>
        <div
          className="rounded-xl p-4 text-xs font-mono overflow-x-auto"
          style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)' }}
        >
          <table className="w-full">
            <thead>
              <tr style={{ color: 'var(--text-secondary)' }} className="font-semibold">
                <td className="pr-3 pb-2">Data</td>
                <td className="pr-3 pb-2">Descrição</td>
                <td className="pr-3 pb-2">Valor</td>
                <td className="pb-2">Categoria</td>
              </tr>
            </thead>
            <tbody>
              <tr style={{ color: 'var(--text-muted)' }}>
                <td className="pr-3">2026-04-03</td>
                <td className="pr-3">Supermercado</td>
                <td className="pr-3">45.50</td>
                <td>Alimentação</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
