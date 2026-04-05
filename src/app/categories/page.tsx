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
      alert('Image must be under 512KB');
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
    if (confirm('Are you sure you want to delete this category?')) {
      deleteCategory(id);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold gradient-text">Categories</h1>
          <p style={{ color: '#8892a8' }}>Manage your expense and income categories</p>
        </div>
        <button
          onClick={() => setIsAdding(true)}
          className="btn-primary flex items-center gap-2 justify-center w-fit"
        >
          <Plus className="w-5 h-5" />
          Add Category
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
              <h2 className="text-lg font-semibold" style={{ color: '#e8edf5' }}>
                {editingId ? 'Edit Category' : 'New Category'}
              </h2>
              <button
                type="button"
                onClick={() => {
                  setIsAdding(false);
                  setEditingId(null);
                  setForm({ name: '', icon: '📦', color: '#7C3AED', type: 'expense' });
                }}
                className="p-2 rounded-lg transition-colors"
                style={{ color: '#5a6478', background: 'none', border: 'none', cursor: 'pointer' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: '#8892a8' }}>Name</label>
                <input
                  type="text"
                  value={form.name || ''}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Category name"
                  className="input-field"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: '#8892a8' }}>Type</label>
                <select
                  value={form.type || 'expense'}
                  onChange={(e) => setForm({ ...form, type: e.target.value as 'income' | 'expense' })}
                  className="select-field"
                >
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: '#8892a8' }}>Icon</label>
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
                        : 'rgba(255, 255, 255, 0.03)',
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
                      : 'rgba(255, 255, 255, 0.03)',
                    border: form.icon?.startsWith('data:image')
                      ? '2px solid rgba(124, 58, 237, 0.4)'
                      : '2px dashed rgba(255, 255, 255, 0.15)',
                    cursor: 'pointer',
                  }}
                  title="Upload custom icon"
                >
                  {form.icon?.startsWith('data:image') ? (
                    <img src={form.icon} alt="" className="w-7 h-7 rounded object-cover" />
                  ) : (
                    <Upload className="w-4 h-4" style={{ color: '#5a6478' }} />
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
                <p className="text-xs mt-2" style={{ color: '#5a6478' }}>
                  Custom icon uploaded. Click ⬆ to change or select an emoji above.
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: '#8892a8' }}>Color</label>
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
                        ? `0 0 0 2px #0a0f1e, 0 0 0 4px ${color}, 0 0 12px ${color}40`
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
                {editingId ? 'Save Changes' : 'Add Category'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Expense Categories */}
      <div className="glass-card-static p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: '#e8edf5' }}>
          <span className="w-3 h-3 bg-red-500 rounded-full" style={{ boxShadow: '0 0 8px rgba(239, 68, 68, 0.4)' }} />
          Expense Categories
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {expenseCategories.map((cat) => (
            <div
              key={cat.id}
              className="flex items-center justify-between p-3 rounded-xl transition-all"
              style={{
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid rgba(255, 255, 255, 0.06)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'rgba(124, 58, 237, 0.2)';
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.06)';
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)';
              }}
            >
              <div className="flex items-center gap-2">
                <CategoryIcon icon={cat.icon} />
                <span className="font-medium" style={{ color: '#e8edf5' }}>{cat.name}</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleEdit(cat)}
                  className="p-1.5 rounded-lg transition-all"
                  style={{ color: '#5a6478', background: 'none', border: 'none', cursor: 'pointer' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#a78bfa'; e.currentTarget.style.background = 'rgba(124, 58, 237, 0.1)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = '#5a6478'; e.currentTarget.style.background = 'transparent'; }}
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(cat.id)}
                  className="p-1.5 rounded-lg transition-all"
                  style={{ color: '#5a6478', background: 'none', border: 'none', cursor: 'pointer' }}
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
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: '#e8edf5' }}>
          <span className="w-3 h-3 bg-green-500 rounded-full" style={{ boxShadow: '0 0 8px rgba(16, 185, 129, 0.4)' }} />
          Income Categories
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {incomeCategories.map((cat) => (
            <div
              key={cat.id}
              className="flex items-center justify-between p-3 rounded-xl transition-all"
              style={{
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid rgba(255, 255, 255, 0.06)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'rgba(16, 185, 129, 0.2)';
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.06)';
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)';
              }}
            >
              <div className="flex items-center gap-2">
                <CategoryIcon icon={cat.icon} />
                <span className="font-medium" style={{ color: '#e8edf5' }}>{cat.name}</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleEdit(cat)}
                  className="p-1.5 rounded-lg transition-all"
                  style={{ color: '#5a6478', background: 'none', border: 'none', cursor: 'pointer' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#a78bfa'; e.currentTarget.style.background = 'rgba(124, 58, 237, 0.1)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = '#5a6478'; e.currentTarget.style.background = 'transparent'; }}
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(cat.id)}
                  className="p-1.5 rounded-lg transition-all"
                  style={{ color: '#5a6478', background: 'none', border: 'none', cursor: 'pointer' }}
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
