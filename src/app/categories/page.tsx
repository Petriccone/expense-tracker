'use client';

import { useState, useRef } from 'react';
import { Plus, Edit2, Trash2, X, Upload, ImageIcon } from 'lucide-react';
import { useCategories } from '@/context/AppContext';
import { Category } from '@/types';

function CategoryIcon({ icon, size = 'text-2xl' }: { icon: string; size?: string }) {
  if (icon.startsWith('data:image')) {
    return <img src={icon} alt="" className="rounded-md object-cover" style={{ width: '1.5em', height: '1.5em' }} />;
  }
  return <span className={size}>{icon}</span>;
}

const EMOJI_OPTIONS = ['🍔', '🚗', '🏠', '🎬', '🛍️', '💊', '📚', '💡', '📦', '💰', '💻', '📈', '🎁', '💵', '✈️', '🏋️', '🎮', '🎵', '👗', '🍳'];
const COLOR_OPTIONS = ['#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6', '#EC4899', '#06B6D4', '#6366F1', '#64748B', '#84CC16'];

export default function CategoriesPage() {
  const { categories, addCategory, updateCategory, deleteCategory } = useCategories();
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Category>>({
    name: '',
    icon: '📦',
    color: '#7C3AED',
    type: 'expense',
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleIconUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    if (file.size > 512 * 1024) {
      alert('A imagem deve ter menos de 512KB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setForm({ ...form, icon: result });
    };
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const expenseCategories = categories.filter((c) => c.type === 'expense');
  const incomeCategories = categories.filter((c) => c.type === 'income');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name) return;

    if (editingId) {
      updateCategory({ ...form, id: editingId } as Category);
      setEditingId(null);
    } else {
      addCategory({
        ...form,
        id: Date.now().toString(),
      } as Category);
    }

    setForm({ name: '', icon: '📦', color: '#7C3AED', type: 'expense' });
    setIsAdding(false);
  };

  const handleEdit = (cat: Category) => {
    setEditingId(cat.id);
    setForm(cat);
    setIsAdding(true);
  };

  const handleDelete = (id: string) => {
    if (confirm('Tem certeza que deseja excluir esta categoria?')) {
      deleteCategory(id);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold gradient-text">Categorias</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Gerencie suas categorias de despesas e receitas</p>
        </div>
        <button
          onClick={() => setIsAdding(true)}
          className="btn-primary flex items-center gap-2 justify-center w-fit"
        >
          <Plus className="w-5 h-5" />
          Adicionar Categoria
        </button>
      </div>

      {/* Add/Edit Form */}
      {isAdding && (
        <div
          className="glass-strong p-6 animate-slideUp"
          style={{ border: '1px solid rgba(124, 58, 237, 0.2)' }}
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                {editingId ? 'Editar Categoria' : 'Nova Categoria'}
              </h2>
              <button
                type="button"
                onClick={() => {
                  setIsAdding(false);
                  setEditingId(null);
                  setForm({ name: '', icon: '📦', color: '#7C3AED', type: 'expense' });
                }}
                className="p-2 rounded-lg transition-colors"
                style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover-bg)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Nome</label>
                <input
                  type="text"
                  value={form.name || ''}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Nome da categoria"
                  className="input-field"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Tipo</label>
                <select
                  value={form.type || 'expense'}
                  onChange={(e) => setForm({ ...form, type: e.target.value as 'income' | 'expense' })}
                  className="select-field"
                >
                  <option value="expense">Despesa</option>
                  <option value="income">Receita</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Ícone</label>
              <div className="flex flex-wrap gap-2 items-center">
                {EMOJI_OPTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => setForm({ ...form, icon: emoji })}
                    className="w-10 h-10 text-xl rounded-lg transition-all"
                    style={{
                      background: form.icon === emoji
                        ? 'linear-gradient(135deg, rgba(124, 58, 237, 0.2), rgba(6, 182, 212, 0.1))'
                        : 'var(--bg-input)',
                      border: form.icon === emoji
                        ? '2px solid rgba(124, 58, 237, 0.4)'
                        : '2px solid transparent',
                      boxShadow: form.icon === emoji ? '0 0 12px rgba(124, 58, 237, 0.15)' : 'none',
                      cursor: 'pointer',
                    }}
                  >
                    {emoji}
                  </button>
                ))}
                {/* Upload custom icon */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-10 h-10 rounded-lg transition-all flex items-center justify-center"
                  style={{
                    background: form.icon?.startsWith('data:image')
                      ? 'linear-gradient(135deg, rgba(124, 58, 237, 0.2), rgba(6, 182, 212, 0.1))'
                      : 'var(--bg-input)',
                    border: form.icon?.startsWith('data:image')
                      ? '2px solid rgba(124, 58, 237, 0.4)'
                      : '2px dashed var(--dashed-border)',
                    cursor: 'pointer',
                  }}
                  title="Enviar ícone personalizado"
                >
                  {form.icon?.startsWith('data:image') ? (
                    <img src={form.icon} alt="" className="w-7 h-7 rounded object-cover" />
                  ) : (
                    <Upload className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                  )}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleIconUpload}
                  className="hidden"
                />
              </div>
              {form.icon?.startsWith('data:image') && (
                <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                  Ícone personalizado enviado. Clique em ⬆ para alterar ou selecione um emoji acima.
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Cor</label>
              <div className="flex flex-wrap gap-2">
                {COLOR_OPTIONS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setForm({ ...form, color })}
                    className="w-8 h-8 rounded-lg transition-all"
                    style={{
                      backgroundColor: color,
                      boxShadow: form.color === color
                        ? `0 0 0 2px var(--bg-base), 0 0 0 4px ${color}, 0 0 12px ${color}40`
                        : 'none',
                      cursor: 'pointer',
                      border: 'none',
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <button type="submit" className="btn-primary flex-1">
                {editingId ? 'Salvar Alterações' : 'Adicionar Categoria'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Expense Categories */}
      <div className="glass-card-static p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <span className="w-3 h-3 bg-red-500 rounded-full" style={{ boxShadow: '0 0 8px rgba(239, 68, 68, 0.4)' }} />
          Categorias de Despesas
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {expenseCategories.map((cat) => (
            <div
              key={cat.id}
              className="flex items-center justify-between p-3 rounded-xl transition-all"
              style={{
                background: 'var(--bg-input)',
                border: '1px solid var(--border-color)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'rgba(124, 58, 237, 0.2)';
                e.currentTarget.style.background = 'var(--hover-bg)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-color)';
                e.currentTarget.style.background = 'var(--bg-input)';
              }}
            >
              <div className="flex items-center gap-2">
                <CategoryIcon icon={cat.icon} />
                <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{cat.name}</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleEdit(cat)}
                  className="p-1.5 rounded-lg transition-all"
                  style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#a78bfa'; e.currentTarget.style.background = 'rgba(124, 58, 237, 0.1)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = '#5a6478'; e.currentTarget.style.background = 'transparent'; }}
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(cat.id)}
                  className="p-1.5 rounded-lg transition-all"
                  style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#f87171'; e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = '#5a6478'; e.currentTarget.style.background = 'transparent'; }}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Income Categories */}
      <div className="glass-card-static p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <span className="w-3 h-3 bg-green-500 rounded-full" style={{ boxShadow: '0 0 8px rgba(16, 185, 129, 0.4)' }} />
          Categorias de Receitas
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {incomeCategories.map((cat) => (
            <div
              key={cat.id}
              className="flex items-center justify-between p-3 rounded-xl transition-all"
              style={{
                background: 'var(--bg-input)',
                border: '1px solid var(--border-color)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'rgba(16, 185, 129, 0.2)';
                e.currentTarget.style.background = 'var(--hover-bg)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-color)';
                e.currentTarget.style.background = 'var(--bg-input)';
              }}
            >
              <div className="flex items-center gap-2">
                <CategoryIcon icon={cat.icon} />
                <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{cat.name}</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleEdit(cat)}
                  className="p-1.5 rounded-lg transition-all"
                  style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#a78bfa'; e.currentTarget.style.background = 'rgba(124, 58, 237, 0.1)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = '#5a6478'; e.currentTarget.style.background = 'transparent'; }}
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(cat.id)}
                  className="p-1.5 rounded-lg transition-all"
                  style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#f87171'; e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = '#5a6478'; e.currentTarget.style.background = 'transparent'; }}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
