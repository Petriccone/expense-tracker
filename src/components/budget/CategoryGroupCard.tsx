'use client';

// One Fixos/Variáveis/Extras card: a colored icon square per category, a
// stacked row (name + Restante headline, full-width progress bar, small
// labeled Planejado/Gasto editable values), plus "+ categoria".
//
// Rows are intentionally NOT a multi-column money grid — these cards render
// side-by-side at ~390px wide, and columns narrow enough to hold long
// currency values (e.g. "€1,397.00") collide with the name. A stacked
// layout with a flex-1/min-w-0/truncate name and a shrink-0 number cell
// structurally cannot overlap regardless of value length.

import { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import InlineMoneyEdit from './InlineMoneyEdit';
import InlineTextEdit from './InlineTextEdit';
import { categoryVisual } from '@/lib/categoryIcons';
import { groupSpentSum } from '@/lib/groupSpent';
import type { BudgetCategory, BudgetGroup } from '@/types/budget';

interface Props {
  group: BudgetGroup;
  label: string;
  categories: BudgetCategory[];
  // Bank-derived spend per category id for the viewed month (wave 2b),
  // {} when the bank isn't connected — gasto/restante fall back to the
  // manual-only values exactly like before.
  bankSpent: Record<string, number>;
  formatAmount: (n: number) => string;
  onUpdateCategory: (id: string, patch: { name?: string; planned?: number; spent?: number }) => Promise<void>;
  onDeleteCategory: (id: string) => Promise<void>;
  onAddCategory: (input: { group: BudgetGroup; name: string; planned: number }) => Promise<void>;
}

function progressColor(pct: number): string {
  if (pct > 100) return '#EF4444';
  if (pct >= 80) return '#F59E0B';
  return '#10B981';
}

function CategoryRow({
  category,
  group,
  bankSpent,
  formatAmount,
  onUpdateCategory,
  onDeleteCategory,
}: {
  category: BudgetCategory;
  group: BudgetGroup;
  bankSpent: number;
  formatAmount: (n: number) => string;
  onUpdateCategory: Props['onUpdateCategory'];
  onDeleteCategory: Props['onDeleteCategory'];
}) {
  const gasto = category.spent + bankSpent;
  const remaining = category.planned - gasto;
  const pct = category.planned > 0 ? (gasto / category.planned) * 100 : gasto > 0 ? 100 : 0;
  const barColor = progressColor(pct);
  const { icon, color } = categoryVisual(category.name, group);

  const handleDelete = async () => {
    if (!confirm(`Remover "${category.name}"?`)) return;
    try {
      await onDeleteCategory(category.id);
    } catch {
      // error surfaced via the page-level banner
    }
  };

  return (
    <div className="py-2.5 group" style={{ borderBottom: '1px solid var(--border-color)' }}>
      {/* Line 1: icon · name (truncates, never wraps into the number) · Restante headline + delete */}
      <div className="flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
          style={{ backgroundColor: `${color}18`, boxShadow: `0 0 10px ${color}22` }}
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <InlineTextEdit
            value={category.name}
            onSave={(name) => onUpdateCategory(category.id, { name })}
            className="text-sm font-medium"
            style={{ color: 'var(--text-primary)' }}
          />
        </div>
        <div className="flex-shrink-0 flex items-center gap-1.5">
          <span className="text-sm font-bold text-right" style={{ color: remaining < 0 ? '#f87171' : '#10B981' }}>
            {formatAmount(remaining)}
          </span>
          <button
            onClick={handleDelete}
            className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
            style={{ color: 'var(--text-muted)' }}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Line 2: full-width progress bar */}
      {category.planned > 0 ? (
        <div className="h-1.5 rounded-full overflow-hidden mt-2" style={{ background: 'var(--bg-input)' }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: barColor, boxShadow: `0 0 8px ${barColor}40` }}
          />
        </div>
      ) : (
        <div
          className="h-1.5 rounded-full border border-dashed mt-2"
          style={{ borderColor: 'var(--border-color)' }}
        />
      )}

      {/* Line 3: labeled, editable Planejado / Gasto */}
      <div className="flex items-center justify-between mt-1.5 text-xs">
        <div className="flex items-center gap-1.5">
          <span style={{ color: 'var(--text-muted)' }}>Planejado</span>
          <InlineMoneyEdit
            value={category.planned}
            onSave={(planned) => onUpdateCategory(category.id, { planned })}
            formatAmount={formatAmount}
            valueClassName="text-xs"
            valueStyle={{ color: 'var(--text-secondary)' }}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <span style={{ color: 'var(--text-muted)' }}>Gasto</span>
          <InlineMoneyEdit
            value={category.spent}
            displayValue={gasto}
            onSave={(spent) => onUpdateCategory(category.id, { spent })}
            formatAmount={formatAmount}
            valueClassName="text-xs"
            valueStyle={{ color: gasto > category.planned ? '#f87171' : 'var(--text-secondary)' }}
          />
        </div>
      </div>

      {/* Line 4: manual/banco breakdown, only when the bank contributed */}
      {bankSpent > 0 && (
        <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          manual {formatAmount(category.spent)} · banco {formatAmount(bankSpent)}
        </p>
      )}
    </div>
  );
}

export default function CategoryGroupCard({
  group,
  label,
  categories,
  bankSpent,
  formatAmount,
  onUpdateCategory,
  onDeleteCategory,
  onAddCategory,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPlanned, setNewPlanned] = useState('');

  const plannedSum = categories.reduce((s, c) => s + c.planned, 0);
  // Must match each row's own gasto = spent + bankSpent, or the card header
  // total silently disagrees with what the rows show (wave 2b fix).
  const spentSum = groupSpentSum(categories, bankSpent);

  const submitAdd = async () => {
    const name = newName.trim();
    const planned = parseFloat(newPlanned);
    if (!name || !Number.isFinite(planned) || planned < 0) return;
    try {
      await onAddCategory({ group, name, planned });
      setNewName('');
      setNewPlanned('');
      setAdding(false);
    } catch {
      // error surfaced via the page-level banner
    }
  };

  return (
    <div className="glass-card-static p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{label}</h2>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {formatAmount(spentSum)} / {formatAmount(plannedSum)}
        </span>
      </div>

      {categories.length === 0 ? (
        <p className="text-sm py-2" style={{ color: 'var(--text-muted)' }}>Nenhuma categoria ainda.</p>
      ) : (
        <div>
          {categories.map((cat) => (
            <CategoryRow
              key={cat.id}
              category={cat}
              group={group}
              bankSpent={bankSpent[cat.id] ?? 0}
              formatAmount={formatAmount}
              onUpdateCategory={onUpdateCategory}
              onDeleteCategory={onDeleteCategory}
            />
          ))}
        </div>
      )}

      {adding ? (
        <div className="flex items-center gap-2 mt-3">
          <input
            type="text"
            placeholder="Nome"
            value={newName}
            autoFocus
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitAdd();
              if (e.key === 'Escape') setAdding(false);
            }}
            className="flex-1 min-w-0 px-2 py-1.5 text-sm rounded-lg"
            style={{ background: 'var(--bg-input)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)', outline: 'none' }}
          />
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="Planejado"
            value={newPlanned}
            onChange={(e) => setNewPlanned(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitAdd();
              if (e.key === 'Escape') setAdding(false);
            }}
            className="w-24 px-2 py-1.5 text-sm rounded-lg"
            style={{ background: 'var(--bg-input)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)', outline: 'none' }}
          />
          <button
            onClick={() => void submitAdd()}
            className="p-1.5 text-green-400 rounded-lg transition-colors"
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(16, 185, 129, 0.1)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            onClick={() => setAdding(false)}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover-bg)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="mt-3 text-xs font-medium flex items-center gap-1"
          style={{ color: '#a78bfa' }}
        >
          <Plus className="w-3.5 h-3.5" /> categoria
        </button>
      )}
    </div>
  );
}
