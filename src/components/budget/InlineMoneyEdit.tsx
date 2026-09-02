'use client';

// Inline-edit pattern reused from the old /budget page: click the value →
// input appears → Enter saves / Esc cancels.

import { useState } from 'react';
import { Check, Edit2, X } from 'lucide-react';

interface InlineMoneyEditProps {
  value: number;
  // Optional read-only display override kept for legacy callers. The budget
  // spent editor passes the displayed total as `value` for both states.
  displayValue?: number;
  disabled?: boolean;
  onSave: (value: number) => Promise<void> | void;
  formatAmount: (n: number) => string;
  valueClassName?: string;
  valueStyle?: React.CSSProperties;
}

export default function InlineMoneyEdit({
  value,
  displayValue,
  disabled = false,
  onSave,
  formatAmount,
  valueClassName,
  valueStyle,
}: InlineMoneyEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setDraft(String(value));
    setEditing(true);
  };
  const cancel = () => {
    setEditing(false);
    setDraft('');
  };
  const save = async () => {
    const n = parseFloat(draft);
    if (!Number.isFinite(n) || n < 0) {
      cancel();
      return;
    }
    setSaving(true);
    try {
      await onSave(n);
      setEditing(false);
    } catch {
      // the hook already surfaces a banner — keep the field open to retry
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <input
          type="number"
          step="0.01"
          min="0"
          value={draft}
          autoFocus
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
            if (e.key === 'Escape') cancel();
          }}
          className="w-20 px-2 py-1 text-sm rounded-lg"
          style={{
            background: 'var(--bg-input)',
            border: '1px solid rgba(124, 58, 237, 0.3)',
            color: 'var(--text-primary)',
            outline: 'none',
          }}
        />
        <button
          onClick={() => void save()}
          disabled={saving}
          className="p-1 text-green-400 rounded-lg transition-colors"
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(16, 185, 129, 0.1)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <Check className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={cancel}
          disabled={saving}
          className="p-1 rounded-lg transition-colors"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover-bg)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={startEdit}
      disabled={disabled}
      title={disabled ? 'Aguardando os dados bancários' : undefined}
      className={`group/edit inline-flex items-center gap-1 ${valueClassName ?? ''}`}
      style={{ background: 'transparent', border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', padding: 0, opacity: disabled ? 0.6 : undefined, ...valueStyle }}
    >
      <span>{formatAmount(displayValue ?? value)}</span>
      <Edit2
        className="w-3 h-3 opacity-0 group-hover/edit:opacity-70 transition-opacity flex-shrink-0"
        style={{ color: 'var(--text-muted)' }}
      />
    </button>
  );
}
