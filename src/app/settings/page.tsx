'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save, Download, Trash2, Moon, Sun, Euro, DollarSign, Ban, Copy, RefreshCw, CheckCircle, XCircle, MessageCircle } from 'lucide-react';
import { useSettings } from '@/context/AppContext';
import { supabase } from '@/lib/supabase';

const LINK_TOKEN_KEY = 'telegram-link-token';

function generateToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function applyThemeClass(darkMode: boolean) {
  if (darkMode) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

export default function SettingsPage() {
  const { settings, setSettings } = useSettings();
  const [form, setForm] = useState(settings);
  const [saved, setSaved] = useState(false);

  // Sync form when settings change (e.g., after initial load)
  useEffect(() => {
    setForm(settings);
  }, [settings]);

  // Telegram link state
  const [linkToken, setLinkToken] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'not_connected' | 'unavailable'>('checking');

  // Load link token on mount - never auto-generate, use default fallback
  useEffect(() => {
    const DEFAULT_TOKEN = 'nDV8UVVnOIHmrJNEIvIlfn6n2CzJL2VA';

    // Check dedicated key first
    let token = localStorage.getItem(LINK_TOKEN_KEY);

    // Check inside app data
    if (!token) {
      try {
        const appData = JSON.parse(localStorage.getItem('expense-tracker-data') || '{}');
        if (appData.linkToken) {
          token = appData.linkToken as string;
        }
      } catch { /* ignore */ }
    }

    // Use default token as fallback (never generate random)
    if (!token) {
      token = DEFAULT_TOKEN;
    }

    localStorage.setItem(LINK_TOKEN_KEY, token);
    setLinkToken(token);

    // Persist in app data too
    try {
      const appData = JSON.parse(localStorage.getItem('expense-tracker-data') || '{}');
      if (appData.linkToken !== token) {
        appData.linkToken = token;
        localStorage.setItem('expense-tracker-data', JSON.stringify(appData));
      }
    } catch { /* ignore */ }
  }, []);

  // Check connection status
  const checkConnection = useCallback(async () => {
    if (!supabase || !linkToken) {
      setConnectionStatus('unavailable');
      return;
    }
    setConnectionStatus('checking');
    try {
      const { data, error } = await supabase
        .from('user_links')
        .select('id')
        .eq('link_token', linkToken)
        .limit(1);

      if (error) {
        console.error('Connection check error:', error);
        setConnectionStatus('unavailable');
        return;
      }
      setConnectionStatus(data && data.length > 0 ? 'connected' : 'not_connected');
    } catch {
      setConnectionStatus('unavailable');
    }
  }, [linkToken]);

  useEffect(() => {
    if (linkToken) {
      checkConnection();
    }
  }, [linkToken, checkConnection]);

  const handleCopyToken = () => {
    navigator.clipboard.writeText(linkToken).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleRegenerateToken = () => {
    if (confirm('Are you sure? You will need to re-link your Telegram bot with the new token.')) {
      const token = generateToken();
      localStorage.setItem(LINK_TOKEN_KEY, token);
      setLinkToken(token);
      setConnectionStatus('not_connected');
    }
  };

  const handleToggleDarkMode = () => {
    const newDarkMode = !form.darkMode;
    const newForm = { ...form, darkMode: newDarkMode };
    setForm(newForm);
    // Apply theme immediately
    applyThemeClass(newDarkMode);
    // Save immediately so LayoutShell picks it up
    setSettings(newForm);
    // Dispatch custom event so LayoutShell can react
    window.dispatchEvent(new Event('theme-change'));
  };

  const handleSave = () => {
    setSettings(form);
    // Ensure theme is applied
    applyThemeClass(form.darkMode);
    window.dispatchEvent(new Event('theme-change'));
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
        <h1 className="text-2xl md:text-3xl font-bold gradient-text">Settings</h1>
        <p style={{ color: 'var(--text-secondary)' }}>Customize your experience</p>
      </div>

      {/* Currency */}
      <div className="glass-card-static p-6">
        <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Currency</h2>
        <div className="grid grid-cols-3 gap-3">
          {[
            { value: 'EUR', label: 'Euro', icon: Euro, symbol: '\u20ac' },
            { value: 'USD', label: 'US Dollar', icon: DollarSign, symbol: '$' },
            { value: 'BRL', label: 'Real', icon: Ban, symbol: 'R$' },
          ].map((curr) => (
            <button
              key={curr.value}
              onClick={() => {
                const newForm = { ...form, currency: curr.value };
                setForm(newForm);
                setSettings(newForm);
              }}
              className="p-4 rounded-xl transition-all"
              style={{
                background: form.currency === curr.value
                  ? 'linear-gradient(135deg, rgba(124, 58, 237, 0.15), rgba(6, 182, 212, 0.08))'
                  : 'var(--bg-input)',
                border: form.currency === curr.value
                  ? '2px solid rgba(124, 58, 237, 0.4)'
                  : '2px solid var(--border-color)',
                boxShadow: form.currency === curr.value
                  ? '0 0 20px rgba(124, 58, 237, 0.15)'
                  : 'none',
                cursor: 'pointer',
              }}
            >
              <div className="text-2xl mb-1" style={{
                color: form.currency === curr.value ? '#a78bfa' : 'var(--text-secondary)',
              }}>{curr.symbol}</div>
              <div className="text-sm font-medium" style={{
                color: form.currency === curr.value ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}>{curr.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Monthly Budget */}
      <div className="glass-card-static p-6">
        <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Monthly Budget</h2>
        <div>
          <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
            Monthly Expense Limit
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: 18, fontWeight: 600, minWidth: 24 }}>
              {form.currency === 'EUR' ? '\u20ac' : form.currency === 'USD' ? '$' : 'R$'}
            </span>
            <input
              type="number"
              min="0"
              step="100"
              value={form.monthlyBudget || ''}
              onChange={(e) => {
                const val = parseFloat(e.target.value) || 0;
                const newForm = { ...form, monthlyBudget: val };
                setForm(newForm);
                setSettings(newForm);
              }}
              placeholder="0"
              className="input-field"
              style={{ flex: 1 }}
            />
          </div>
          <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>
            Set a limit to get budget warnings when approaching or exceeding it.
          </p>
        </div>
      </div>

      {/* Appearance */}
      <div className="glass-card-static p-6">
        <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Appearance</h2>
        <button
          onClick={handleToggleDarkMode}
          className="w-full flex items-center justify-between p-4 rounded-xl transition-all"
          style={{
            background: 'var(--bg-input)',
            border: '1px solid var(--border-color)',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(124, 58, 237, 0.3)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; }}
        >
          <div className="flex items-center gap-3">
            {form.darkMode ? (
              <Moon className="w-5 h-5" style={{ color: '#a78bfa' }} />
            ) : (
              <Sun className="w-5 h-5" style={{ color: '#a78bfa' }} />
            )}
            <div className="text-left">
              <p className="font-medium" style={{ color: 'var(--text-primary)' }}>Dark Mode</p>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {form.darkMode ? 'Currently using dark theme' : 'Currently using light theme'}
              </p>
            </div>
          </div>
          <div
            className="w-12 h-6 rounded-full transition-colors relative"
            style={{
              background: form.darkMode
                ? 'linear-gradient(135deg, #7C3AED, #06B6D4)'
                : 'var(--text-muted)',
              boxShadow: form.darkMode ? '0 0 12px rgba(124, 58, 237, 0.3)' : 'none',
            }}
          >
            <div className={`w-5 h-5 bg-white rounded-full shadow transform transition-transform ${
              form.darkMode ? 'translate-x-6' : 'translate-x-0.5'
            } mt-0.5`} />
          </div>
        </button>
      </div>

      {/* Telegram Bot Integration */}
      <div className="glass-card-static p-6">
        <div className="flex items-center gap-3 mb-4">
          <MessageCircle className="w-5 h-5" style={{ color: '#a78bfa' }} />
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Telegram Bot</h2>
        </div>

        {/* Connection Status */}
        <div className="flex items-center gap-2 mb-4">
          {connectionStatus === 'checking' && (
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Checking connection...</span>
          )}
          {connectionStatus === 'connected' && (
            <>
              <CheckCircle className="w-4 h-4 text-green-400" />
              <span className="text-sm text-green-400 font-medium">Connected to Telegram</span>
            </>
          )}
          {connectionStatus === 'not_connected' && (
            <>
              <XCircle className="w-4 h-4 text-amber-400" />
              <span className="text-sm text-amber-400 font-medium">Not linked yet</span>
            </>
          )}
          {connectionStatus === 'unavailable' && (
            <>
              <XCircle className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Supabase not configured</span>
            </>
          )}
        </div>

        {/* Link Token */}
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
            Your Link Token
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              value={linkToken}
              className="input-field flex-1 font-mono text-sm"
            />
            <button
              onClick={handleCopyToken}
              className="px-4 py-2 rounded-xl transition-all flex items-center gap-2"
              style={{
                background: 'var(--bg-input)',
                border: '1px solid var(--glass-border)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'rgba(124, 58, 237, 0.3)';
                e.currentTarget.style.background = 'rgba(124, 58, 237, 0.08)';
                e.currentTarget.style.color = '#a78bfa';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--glass-border)';
                e.currentTarget.style.background = 'var(--bg-input)';
                e.currentTarget.style.color = 'var(--text-secondary)';
              }}
            >
              <Copy className="w-4 h-4" />
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>

        {/* Instructions */}
        <div
          className="rounded-xl p-4 mb-4"
          style={{
            background: 'linear-gradient(135deg, rgba(124, 58, 237, 0.08), rgba(6, 182, 212, 0.04))',
            border: '1px solid rgba(124, 58, 237, 0.15)',
          }}
        >
          <p className="text-sm font-medium mb-2 gradient-text">How to connect:</p>
          <ol className="text-sm space-y-1 list-decimal list-inside" style={{ color: 'var(--text-secondary)' }}>
            <li>Open <span className="font-medium" style={{ color: 'var(--text-primary)' }}>@ExpenseTrackerBot</span> on Telegram</li>
            <li>Send <code className="px-1.5 py-0.5 rounded text-xs font-mono" style={{ background: 'rgba(124, 58, 237, 0.15)', color: '#c4b5fd' }}>/link YOUR_TOKEN</code></li>
            <li>Start sending voice messages!</li>
          </ol>
        </div>

        {/* Regenerate Token */}
        <button
          onClick={handleRegenerateToken}
          className="flex items-center gap-2 text-sm transition-colors"
          style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#a78bfa'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
        >
          <RefreshCw className="w-4 h-4" />
          Regenerate Token
        </button>
      </div>

      {/* Data Management */}
      <div className="glass-card-static p-6">
        <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Data Management</h2>
        <div className="space-y-3">
          <button
            onClick={handleExport}
            className="w-full flex items-center gap-3 p-4 rounded-xl transition-all"
            style={{
              background: 'var(--bg-input)',
              border: '1px solid var(--border-color)',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(124, 58, 237, 0.3)'; e.currentTarget.style.background = 'rgba(124, 58, 237, 0.05)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.background = 'var(--bg-input)'; }}
          >
            <Download className="w-5 h-5" style={{ color: '#a78bfa' }} />
            <div className="text-left">
              <p className="font-medium" style={{ color: 'var(--text-primary)' }}>Export Data</p>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Download all your data as JSON</p>
            </div>
          </button>
          <button
            onClick={handleClearData}
            className="w-full flex items-center gap-3 p-4 rounded-xl transition-all"
            style={{
              background: 'rgba(239, 68, 68, 0.04)',
              border: '1px solid rgba(239, 68, 68, 0.15)',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.3)'; e.currentTarget.style.background = 'rgba(239, 68, 68, 0.08)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.15)'; e.currentTarget.style.background = 'rgba(239, 68, 68, 0.04)'; }}
          >
            <Trash2 className="w-5 h-5 text-red-400" />
            <div className="text-left">
              <p className="font-medium text-red-400">Clear All Data</p>
              <p className="text-sm" style={{ color: 'rgba(239, 68, 68, 0.6)' }}>Permanently delete all transactions</p>
            </div>
          </button>
        </div>
      </div>

      {/* Save Button */}
      <button
        onClick={handleSave}
        className="btn-primary w-full py-4 flex items-center justify-center gap-2 animate-pulse-glow"
      >
        <Save className="w-5 h-5" />
        {saved ? 'Saved!' : 'Save Settings'}
      </button>

      {/* Version Info */}
      <div className="text-center text-sm" style={{ color: 'var(--text-muted)' }}>
        <p>ExpensesAI v1.0.0</p>
        <p>Built with Next.js + Tailwind CSS</p>
      </div>
    </div>
  );
}
