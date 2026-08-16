'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { RefreshCw, CheckCircle2, AlertCircle, Plug2, Server, Search, Building2 } from 'lucide-react';

interface HealthInfo {
  ok: boolean;
  size: number;
}

interface Institution {
  id: string;
  name: string;
  bic?: string;
  logo?: string;
}

export default function ConnectionsPage() {
  const router = useRouter();
  const search = useSearchParams();
  const ok = search.get('ok') === '1';
  const error = search.get('error');

  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<Record<string, unknown> | null>(null);

  const [institutions, setInstitutions] = useState<Institution[] | null>(null);
  const [instError, setInstError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ ok: false, size: 0 }));
  }, []);

  useEffect(() => {
    fetch('/api/gocardless/institutions?country=IE')
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok || !Array.isArray(data)) {
          throw new Error((data && data.error) || 'Failed to load banks');
        }
        return data as Institution[];
      })
      .then((list) => {
        setInstitutions(list);
        setInstError(null);
      })
      .catch((e) => setInstError(e instanceof Error ? e.message : 'Failed to load banks'));
  }, []);

  const filtered = useMemo(() => {
    if (!institutions) return [];
    const q = query.trim().toLowerCase();
    if (!q) return institutions;
    return institutions.filter((i) => i.name.toLowerCase().includes(q) || i.id.toLowerCase().includes(q));
  }, [institutions, query]);

  const onConnect = async (institutionId: string) => {
    setConnectingId(institutionId);
    setConnectError(null);
    try {
      const res = await fetch('/api/gocardless/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ institution_id: institutionId }),
      });
      const data = await res.json();
      if (!res.ok || !data.link) {
        throw new Error(data.error || 'Could not start bank connection');
      }
      // Hand off to the bank's consent screen.
      window.location.href = data.link;
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : 'Could not start bank connection');
      setConnectingId(null);
    }
  };

  const onSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/gocardless/manual-sync', { method: 'POST' });
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
          Connect your Irish bank to pull transactions automatically. Powered by GoCardless Bank Account Data.
        </p>
      </div>

      {ok && (
        <div className="glass-card-static p-4 flex items-start gap-3" style={{ borderLeft: '4px solid #10B981' }}>
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
        <div className="glass-card-static p-4 flex items-start gap-3" style={{ borderLeft: '4px solid #EF4444' }}>
          <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: '#EF4444' }} />
          <div>
            <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
              Connection failed
            </p>
            <p style={{ color: 'var(--text-secondary)' }} className="text-sm">
              {decodeURIComponent(error)}
            </p>
          </div>
        </div>
      )}

      <div className="glass-card-static p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: 'rgba(124, 58, 237, 0.15)' }}>
            <Plug2 className="w-6 h-6" style={{ color: '#a78bfa' }} />
          </div>
          <div>
            <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>
              Connect a bank
            </p>
            <p style={{ color: 'var(--text-secondary)' }} className="text-sm">
              Pick your bank, log in on their site, and consent. Tokens stored encrypted in SQLite.
            </p>
          </div>
        </div>

        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Irish banks (e.g. Revolut, AIB, Bank of Ireland)..."
            className="w-full pl-9 pr-3 py-2 rounded-lg text-sm"
            style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
            data-testid="bank-search"
          />
        </div>

        {connectError && (
          <p className="text-sm" style={{ color: '#EF4444' }}>
            {connectError}
          </p>
        )}

        {instError ? (
          <p className="text-sm" style={{ color: '#EF4444' }}>
            Could not load banks: {instError}
          </p>
        ) : institutions === null ? (
          <p style={{ color: 'var(--text-secondary)' }} className="text-sm">
            Loading banks...
          </p>
        ) : (
          <div className="max-h-96 overflow-y-auto space-y-2" data-testid="bank-list">
            {filtered.length === 0 ? (
              <p style={{ color: 'var(--text-muted)' }} className="text-sm">
                No banks match “{query}”.
              </p>
            ) : (
              filtered.map((inst) => (
                <div
                  key={inst.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-lg"
                  style={{ background: 'var(--bg-input)' }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {inst.logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={inst.logo} alt="" className="w-8 h-8 rounded object-contain flex-shrink-0" />
                    ) : (
                      <div className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(124,58,237,0.15)' }}>
                        <Building2 className="w-4 h-4" style={{ color: '#a78bfa' }} />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                        {inst.name}
                      </p>
                      {inst.bic && (
                        <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                          {inst.bic}
                        </p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => onConnect(inst.id)}
                    disabled={connectingId !== null}
                    className="btn-primary text-sm flex-shrink-0"
                    data-testid={`connect-${inst.id}`}
                  >
                    {connectingId === inst.id ? 'Opening...' : 'Connect'}
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div className="glass-card-static p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p style={{ color: 'var(--text-primary)' }} className="font-medium">
              Sync now
            </p>
            <p style={{ color: 'var(--text-secondary)' }} className="text-sm">
              Pulls latest transactions from your linked banks. Deduped on transaction id.
            </p>
          </div>
          <button onClick={onSync} disabled={syncing} className="btn-secondary flex items-center gap-2">
            <RefreshCw className={syncing ? 'w-4 h-4 animate-spin' : 'w-4 h-4'} />
            {syncing ? 'Syncing...' : 'Sync now'}
          </button>
        </div>

        {syncResult && (
          <pre className="mt-2 p-3 rounded-lg text-xs overflow-x-auto" style={{ background: 'var(--bg-input)', color: 'var(--text-secondary)' }}>
            {JSON.stringify(syncResult, null, 2)}
          </pre>
        )}
      </div>

      <div className="glass-card-static p-6 space-y-3">
        <div className="flex items-center gap-3">
          <Server className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
          <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>
            Local storage
          </h2>
        </div>
        {health === null ? (
          <p style={{ color: 'var(--text-secondary)' }} className="text-sm">
            Checking...
          </p>
        ) : !health.ok ? (
          <p style={{ color: '#EF4444' }} className="text-sm">
            SQLite unavailable.
          </p>
        ) : (
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
            <div>
              <dt style={{ color: 'var(--text-muted)' }}>Size</dt>
              <dd style={{ color: 'var(--text-primary)' }}>{(health.size / 1024).toFixed(1)} KB</dd>
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
