'use client';

// Same inline-edit pattern as InlineMoneyEdit, for text fields (category
// name, income label).

import { useState } from 'react';
import { Check, Edit2, X } from 'lucide-react';

interface InlineTextEditProps {
  value: string;
  onSave: (value: string) => Promise<void> | void;
  className?: string;
  style?: React.CSSProperties;
}

export default function InlineTextEdit({ value, onSave, className, style }: InlineTextEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setDraft(value);
    setEditing(true);
  };
  const cancel = () => setEditing(false);
  const save = async () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      cancel();
      return;
    }
    setSaving(true);
    try {
      await onSave(trimmed);
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
          type="text"
          value={draft}
          autoFocus
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
            if (e.key === 'Escape') cancel();
          }}
          className="w-32 px-2 py-1 text-sm rounded-lg"
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
      className={`group/edit inline-flex items-center gap-1 text-left ${className ?? ''}`}
      style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, ...style }}
    >
      <span className="truncate">{value}</span>
      <Edit2
        className="w-3 h-3 opacity-0 group-hover/edit:opacity-70 transition-opacity flex-shrink-0"
        style={{ color: 'var(--text-muted)' }}
      />
    </button>
  );
}
