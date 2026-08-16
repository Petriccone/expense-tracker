// Pure client-side presentation helper for the budget page. BudgetCategory
// has no icon/color field in the data model — this maps a category's name
// (case/spacing-insensitive) to an emoji + accent color so the budget rows
// look like the old page. Unknown names fall back to a per-group default.

import type { BudgetGroup } from '@/types/budget';

export interface CategoryVisual {
  icon: string;
  color: string;
}

const NAME_VISUALS: Record<string, CategoryVisual> = {
  insurance: { icon: '🛡️', color: '#22d3ee' },
  phone: { icon: '📱', color: '#a78bfa' },
  shop: { icon: '🛒', color: '#f59e0b' },
  shopping: { icon: '🛒', color: '#f59e0b' },
  eletricity: { icon: '⚡', color: '#facc15' },
  electricity: { icon: '⚡', color: '#facc15' },
  youtube: { icon: '▶️', color: '#ef4444' },
  loan: { icon: '🏦', color: '#60a5fa' },
  apple: { icon: '🍎', color: '#f87171' },
  amazon: { icon: '📦', color: '#fb923c' },
  spotify: { icon: '🎵', color: '#22c55e' },
  wifi: { icon: '📶', color: '#38bdf8' },
  'leap card': { icon: '🚌', color: '#34d399' },
  botfy: { icon: '🤖', color: '#a78bfa' },
  netflix: { icon: '🎬', color: '#ef4444' },
  lashes: { icon: '👁️', color: '#f472b6' },
  'eye lashes': { icon: '👁️', color: '#f472b6' },
  'hair cut': { icon: '✂️', color: '#c084fc' },
  nail: { icon: '💅', color: '#f472b6' },
  pills: { icon: '💊', color: '#f87171' },
  fuel: { icon: '⛽', color: '#fb923c' },
  gym: { icon: '🏋️', color: '#34d399' },
  cleaner: { icon: '🧹', color: '#60a5fa' },
  rental: { icon: '🏠', color: '#fbbf24' },
  toll: { icon: '🛣️', color: '#94a3b8' },
  'pay later': { icon: '🕓', color: '#a78bfa' },
  'credit card': { icon: '💳', color: '#818cf8' },
  'car wash': { icon: '🚗', color: '#22d3ee' },
  macbook: { icon: '💻', color: '#94a3b8' },
  bcn: { icon: '✈️', color: '#38bdf8' },
  deliveroo: { icon: '🛵', color: '#22c55e' },
  mounjaro: { icon: '💉', color: '#f472b6' },
};

const GROUP_DEFAULTS: Record<BudgetGroup, CategoryVisual> = {
  fixed: { icon: '🧾', color: '#a78bfa' },
  variable: { icon: '🔁', color: '#22d3ee' },
  extra: { icon: '✨', color: '#f59e0b' },
};

function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function categoryVisual(name: string, group: BudgetGroup): CategoryVisual {
  return NAME_VISUALS[normalize(name)] ?? GROUP_DEFAULTS[group];
}
