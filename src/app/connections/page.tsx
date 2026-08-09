'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { RefreshCw, ExternalLink, CheckCircle2, AlertCircle, Plug2, Server } from 'lucide-react';

interface HealthInfo {
  ok: boolean;
  path: string;
  size: number;
  tables: string[];
}

export default function ConnectionsPage() {
  const router = useRouter();
  const search = useSearchParams();
  const ok = search.get('ok') === '1';
  const error = search.get('error');

  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then(r => r.json())
      .then(setHealth)
      .catch(() => setHealth({ ok: false, path: '', size: 0, tables: [] }));
  }, []);

  const onSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/truelayer/sync', { method: 'POST' });
      setSyncResult(await res.json());
      router.refresh();
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold gradient-text">Bank Connections</h1>
        <p style={{ color: 'var(--text-secondary)' }} className="mt-1">
          Connect your bank to pull transactions automatically. Revolut supported via TrueLayer (sandbox).
        </p>
      </div>

      {ok && (
        <div
          className="glass-card-static p-4 flex items-start gap-3"
          style={{ borderLeft: '4px solid #10B981' }}
        >
          <CheckCircle2 className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: '#10B981' }} />
          <div>
            <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
              Connected.
            </p>
            <p style={{ color: 'var(--text-secondary)' }} className="text-sm">
              Initial sync kicked off. Refresh in a minute or click Sync below.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div
          className="glass-card-static p-4 flex items-start gap-3"
          style={{ borderLeft: '4px solid #EF4444' }}
        >
          <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: '#EF4444' }} />
          <div>
            <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
              Connection failed
            </p>
            <p style={{ color: 'var(--text-secondary)' }} className="text-sm">{decodeURIComponent(error)}</p>
          </div>
        </div>
      )}

      <div className="glass-card-static p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: 'rgba(124, 58, 237, 0.15)' }}>
              <Plug2 className="w-6 h-6" style={{ color: '#a78bfa' }} />
            </div>
            <div>
              <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>TrueLayer (Revolut)</p>
              <p style={{ color: 'var(--text-secondary)' }} className="text-sm">
                OAuth + sandbox/live. Tokens stored encrypted in SQLite.
              </p>
            </div>
          </div>
          <a
            href="/api/truelayer/connect"
            className="btn-primary flex items-center gap-2"
            data-testid="truelayer-connect"
          >
            <ExternalLink className="w-4 h-4" />
            Connect bank
          </a>
        </div>

        <div className="flex items-center justify-between pt-4" style={{ borderTop: '1px solid var(--border-color)' }}>
          <div>
            <p style={{ color: 'var(--text-primary)' }} className="font-medium">Sync now</p>
            <p style={{ color: 'var(--text-secondary)' }} className="text-sm">
              Pulls latest transactions from TrueLayer. Deduped on transaction id.
            </p>
          </div>
          <button
            onClick={onSync}
            disabled={syncing}
            className="btn-secondary flex items-center gap-2"
          >
            <RefreshCw className={syncing ? 'w-4 h-4 animate-spin' : 'w-4 h-4'} />
            {syncing ? 'Syncing...' : 'Sync now'}
          </button>
        </div>

        {syncResult && (
          <pre
            className="mt-4 p-3 rounded-lg text-xs overflow-x-auto"
            style={{ background: 'var(--bg-input)', color: 'var(--text-secondary)' }}
          >
            {JSON.stringify(syncResult, null, 2)}
          </pre>
        )}
      </div>

      <div className="glass-card-static p-6 space-y-3">
        <div className="flex items-center gap-3">
          <Server className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
          <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Local storage</h2>
        </div>
        {health === null ? (
          <p style={{ color: 'var(--text-secondary)' }} className="text-sm">Checking...</p>
        ) : !health.ok ? (
          <p style={{ color: '#EF4444' }} className="text-sm">SQLite unavailable.</p>
        ) : (
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
            <div>
              <dt style={{ color: 'var(--text-muted)' }}>Path</dt>
              <dd className="font-mono text-xs" style={{ color: 'var(--text-primary)' }}>{health.path}</dd>
            </div>
            <div>
              <dt style={{ color: 'var(--text-muted)' }}>Size</dt>
              <dd style={{ color: 'var(--text-primary)' }}>{(health.size / 1024).toFixed(1)} KB</dd>
            </div>
            <div className="md:col-span-2">
              <dt style={{ color: 'var(--text-muted)' }}>Tables</dt>
              <dd className="font-mono text-xs" style={{ color: 'var(--text-primary)' }}>
                {health.tables.join(', ') || '(none)'}
              </dd>
            </div>
          </dl>
        )}
      </div>

      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        After connecting, transactions appear under{' '}
        <Link href="/transactions" className="underline" style={{ color: '#a78bfa' }}>
          /transactions
        </Link>{' '}
        once they sync.
      </p>
    </div>
  );
}