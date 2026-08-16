'use client';

// Connection status card for /banco — not connected shows a "Conectar
// Revolut" CTA (a plain <a> to the 302-redirect endpoint), connected shows
// last sync / accounts / tx count / consent expiry with a reconnect warning
// inside the last ~14 days.

import { AlertTriangle, CheckCircle2, Landmark } from 'lucide-react';
import type { BankingStatus } from '@/types/banking';

interface Props {
  status: BankingStatus | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

const RECONNECT_WARNING_DAYS = 14;

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${date} ${time}`;
}

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export default function BankStatusCard({ status, loading, error, onRetry }: Props) {
  if (loading && !status) {
    return (
      <div className="glass-card-static p-8 flex items-center justify-center">
        <div
          style={{
            width: 28,
            height: 28,
            border: '3px solid var(--border-color)',
            borderTopColor: '#7C3AED',
            borderRadius: '50%',
            animation: 'spin 0.6s linear infinite',
          }}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-card-static p-4 flex items-center justify-between gap-3" style={{ borderLeft: '3px solid #EF4444' }}>
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{error}</p>
        </div>
        <button onClick={onRetry} className="btn-secondary text-sm flex-shrink-0">Tentar de novo</button>
      </div>
    );
  }

  if (!status || !status.connected) {
    return (
      <div className="glass-card-static p-6" style={{ borderLeft: '3px solid #7C3AED' }}>
        <div className="flex items-start gap-4">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(124, 58, 237, 0.15)', boxShadow: '0 0 16px rgba(124, 58, 237, 0.15)' }}
          >
            <Landmark className="w-6 h-6" style={{ color: '#a78bfa' }} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Conecte sua conta Revolut</h2>
            <p className="text-sm mt-1 mb-4" style={{ color: 'var(--text-secondary)' }}>
              Importa as transações automaticamente todo dia e sugere a categoria de cada gasto.
            </p>
            <a href="/api/banking/connect" className="btn-primary inline-flex">Conectar Revolut</a>
          </div>
        </div>
      </div>
    );
  }

  const expiring = status.validUntil !== null && daysUntil(status.validUntil) <= RECONNECT_WARNING_DAYS;

  return (
    <div className="glass-card-static p-6" style={{ borderLeft: `3px solid ${expiring ? '#F59E0B' : '#10B981'}` }}>
      <div className="flex items-center gap-3 mb-4">
        <CheckCircle2 className="w-5 h-5 flex-shrink-0" style={{ color: '#10B981' }} />
        <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Revolut conectado</h2>
      </div>

      <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div>
          <dt style={{ color: 'var(--text-muted)' }}>Última sincronização</dt>
          <dd style={{ color: 'var(--text-primary)' }}>{formatDateTime(status.lastSync)}</dd>
        </div>
        <div>
          <dt style={{ color: 'var(--text-muted)' }}>Contas</dt>
          <dd style={{ color: 'var(--text-primary)' }}>{status.accountCount}</dd>
        </div>
        <div>
          <dt style={{ color: 'var(--text-muted)' }}>Transações</dt>
          <dd style={{ color: 'var(--text-primary)' }}>{status.txCount}</dd>
        </div>
        <div>
          <dt style={{ color: 'var(--text-muted)' }}>Consentimento válido até</dt>
          <dd style={{ color: expiring ? '#F59E0B' : 'var(--text-primary)' }}>{formatDateTime(status.validUntil)}</dd>
        </div>
      </dl>

      {expiring && (
        <div className="flex items-center justify-between gap-3 mt-4 pt-4" style={{ borderTop: '1px solid var(--border-color)' }}>
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: '#F59E0B' }} />
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              O consentimento expira em breve — reconecte para não perder a sincronização.
            </p>
          </div>
          <a href="/api/banking/connect" className="btn-secondary text-sm flex-shrink-0">Reconectar</a>
        </div>
      )}
    </div>
  );
}
