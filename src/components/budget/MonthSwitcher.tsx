'use client';

import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';

interface Props {
  label: string;
  canGoPrev: boolean;
  canGoNext: boolean;
  isLatest: boolean;
  creating: boolean;
  onPrev: () => void;
  onNext: () => void;
  onCreateNext: () => void;
}

export default function MonthSwitcher({ label, canGoPrev, canGoNext, isLatest, creating, onPrev, onNext, onCreateNext }: Props) {
  return (
    <div className="flex items-center gap-3 self-start md:self-auto">
      <div
        className="flex items-center justify-center gap-3"
        style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: 12, padding: '6px 8px' }}
      >
        <button
          onClick={onPrev}
          disabled={!canGoPrev}
          className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors disabled:opacity-30"
          style={{ color: 'var(--text-secondary)' }}
          onMouseEnter={(e) => { if (canGoPrev) e.currentTarget.style.background = 'var(--hover-bg)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-semibold min-w-[100px] text-center" style={{ color: 'var(--text-primary)' }}>
          {label}
        </span>
        <button
          onClick={onNext}
          disabled={!canGoNext}
          className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors disabled:opacity-30"
          style={{ color: 'var(--text-secondary)' }}
          onMouseEnter={(e) => { if (canGoNext) e.currentTarget.style.background = 'var(--hover-bg)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
      {isLatest && (
        <button onClick={onCreateNext} disabled={creating} className="btn-secondary text-sm" style={{ padding: '8px 14px' }}>
          <Plus className="w-4 h-4" /> {creating ? 'Criando…' : 'Novo mês'}
        </button>
      )}
    </div>
  );
}
