'use client';

// Client hook for the couple's budget model — talks to /api/budget/* (fixed
// contract, server-authoritative), never localStorage/AppContext. Any
// mutation refetches the viewed month so rollups stay in sync with the
// server. See docs/2026-08-15-budget-model-redesign-design.md.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BudgetGroup,
  BudgetMonth,
  BudgetMonthSummary,
  BudgetSettings,
  IncomeKind,
} from '@/types/budget';

const MONTH_LABELS_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export function monthLabel(year: number, month: number): string {
  return `${MONTH_LABELS_PT[month - 1] ?? month} ${year}`;
}

export function formatMoney(amount: number, currency = 'EUR'): string {
  const symbol = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : `${currency} `;
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  return `${sign}${symbol}${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let message = `Falha na requisição (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new Error(message);
  }
  // DELETE returns 204 (no body); reading .json() on an empty response throws
  // "Unexpected end of JSON input". Tolerate empty/no-content responses.
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T;
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

interface UseBudgetResult {
  month: BudgetMonth | null;
  months: BudgetMonthSummary[];
  settings: BudgetSettings | null;
  bankSpent: Record<string, number>;
  bankSpentReady: boolean;
  loading: boolean;
  error: string | null;
  clearError: () => void;
  isLatest: boolean;
  canGoPrev: boolean;
  canGoNext: boolean;
  goToPrevMonth: () => void;
  goToNextMonth: () => void;
  reload: () => void;
  createNextMonth: () => Promise<void>;
  updateSave: (save: number) => Promise<void>;
  addCategory: (input: { group: BudgetGroup; name: string; planned: number }) => Promise<void>;
  updateCategory: (id: string, patch: { name?: string; planned?: number; spent?: number; spentAdjustment?: number }) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  addIncome: (input: { label: string; amount: number; kind: IncomeKind }) => Promise<void>;
  updateIncome: (id: string, patch: { label?: string; amount?: number }) => Promise<void>;
  deleteIncome: (id: string) => Promise<void>;
}

export function useBudget(): UseBudgetResult {
  const [months, setMonths] = useState<BudgetMonthSummary[]>([]);
  const [month, setMonth] = useState<BudgetMonth | null>(null);
  const [settings, setSettings] = useState<BudgetSettings | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [bankSpent, setBankSpent] = useState<Record<string, number>>({});
  const [bankSpentReady, setBankSpentReady] = useState(false);

  const clearError = useCallback(() => setError(null), []);
  const reload = useCallback(() => setReloadTick((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [current, list, budgetSettings] = await Promise.all([
          fetchJSON<BudgetMonth>('/api/budget/current'),
          fetchJSON<BudgetMonthSummary[]>('/api/budget/months'),
          fetchJSON<BudgetSettings>('/api/budget/settings'),
        ]);
        if (cancelled) return;
        setMonth(current);
        setViewId(current.id);
        setMonths(list);
        setSettings(budgetSettings);
      } catch (err) {
        if (cancelled) return;
        setMonth(null);
        setError(err instanceof Error ? err.message : 'Não foi possível carregar o orçamento.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  // Bank-derived spend per category for the viewed month (wave 2b). Purely
  // additive display data. A missing/failed snapshot must not be treated as
  // zero while the user is editing a total, so Gasto editing stays disabled
  // until the first valid response and the last valid snapshot is retained
  // across transient failures.
  useEffect(() => {
    if (!month) {
      setBankSpent({});
      setBankSpentReady(false);
      return;
    }
    setBankSpentReady(false);
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchJSON<Record<string, number>>(
          `/api/banking/spent?year=${month.year}&month=${month.month}`,
        );
        if (!cancelled) {
          setBankSpent(data ?? {});
          setBankSpentReady(true);
        }
      } catch {
        // Keep the last successful snapshot. The page disables Gasto editing
        // until a fresh snapshot succeeds, avoiding a wrong correction based
        // on a transiently empty bank result.
        if (!cancelled) setBankSpentReady(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Deliberately keyed on the primitives, not `month` itself — `month` gets
    // a new reference on every refreshViewed() (category/income edits), and
    // none of those should re-trigger a bank-spent refetch, only an actual
    // month switch should.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month?.year, month?.month]);

  // Both switchTo and refreshViewed can be in flight against different
  // months at once (fast month nav, or a mutation refetch racing a nav
  // click). Share one monotonic request id so only the latest of either
  // ever applies its result — an older response resolving late is dropped.
  const monthRequestIdRef = useRef(0);

  const switchTo = useCallback(async (id: string) => {
    const requestId = ++monthRequestIdRef.current;
    try {
      const m = await fetchJSON<BudgetMonth>(`/api/budget/months/${encodeURIComponent(id)}`);
      if (monthRequestIdRef.current !== requestId) return; // superseded
      setMonth(m);
      setViewId(m.id);
    } catch (err) {
      if (monthRequestIdRef.current !== requestId) return; // superseded
      setError(err instanceof Error ? err.message : 'Não foi possível trocar de mês.');
    }
  }, []);

  const refreshViewed = useCallback(async () => {
    if (!viewId) return;
    const requestId = ++monthRequestIdRef.current;
    const m = await fetchJSON<BudgetMonth>(`/api/budget/months/${encodeURIComponent(viewId)}`);
    if (monthRequestIdRef.current !== requestId) return; // superseded
    setMonth(m);
  }, [viewId]);

  const viewIndex = useMemo(
    () => (viewId ? months.findIndex((m) => m.id === viewId) : -1),
    [months, viewId],
  );
  const canGoPrev = viewIndex > 0;
  const canGoNext = viewIndex >= 0 && viewIndex < months.length - 1;
  const isLatest = viewIndex >= 0 && viewIndex === months.length - 1;

  const goToPrevMonth = useCallback(() => {
    if (viewIndex > 0) void switchTo(months[viewIndex - 1].id);
  }, [viewIndex, months, switchTo]);

  const goToNextMonth = useCallback(() => {
    if (viewIndex >= 0 && viewIndex < months.length - 1) void switchTo(months[viewIndex + 1].id);
  }, [viewIndex, months, switchTo]);

  const createNextMonth = useCallback(async () => {
    try {
      const created = await fetchJSON<BudgetMonth>('/api/budget/months', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const list = await fetchJSON<BudgetMonthSummary[]>('/api/budget/months');
      setMonths(list);
      setMonth(created);
      setViewId(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível criar o próximo mês.');
      throw err;
    }
  }, []);

  const updateSave = useCallback(
    async (save: number) => {
      if (!month) return;
      try {
        await fetchJSON(`/api/budget/months/${encodeURIComponent(month.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ save }),
        });
        await refreshViewed();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Não foi possível salvar.');
        throw err;
      }
    },
    [month, refreshViewed],
  );

  const addCategory = useCallback(
    async (input: { group: BudgetGroup; name: string; planned: number }) => {
      if (!month) return;
      try {
        await fetchJSON('/api/budget/categories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ monthId: month.id, ...input }),
        });
        await refreshViewed();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Não foi possível adicionar a categoria.');
        throw err;
      }
    },
    [month, refreshViewed],
  );

  const updateCategory = useCallback(
    async (id: string, patch: { name?: string; planned?: number; spent?: number; spentAdjustment?: number }) => {
      try {
        await fetchJSON(`/api/budget/categories/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        await refreshViewed();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Não foi possível salvar.');
        throw err;
      }
    },
    [refreshViewed],
  );

  const deleteCategory = useCallback(
    async (id: string) => {
      try {
        await fetchJSON(`/api/budget/categories/${encodeURIComponent(id)}`, { method: 'DELETE' });
        await refreshViewed();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Não foi possível remover a categoria.');
        throw err;
      }
    },
    [refreshViewed],
  );

  const addIncome = useCallback(
    async (input: { label: string; amount: number; kind: IncomeKind }) => {
      if (!month) return;
      try {
        await fetchJSON('/api/budget/incomes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ monthId: month.id, ...input }),
        });
        await refreshViewed();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Não foi possível adicionar a renda.');
        throw err;
      }
    },
    [month, refreshViewed],
  );

  const updateIncome = useCallback(
    async (id: string, patch: { label?: string; amount?: number }) => {
      try {
        await fetchJSON(`/api/budget/incomes/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        await refreshViewed();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Não foi possível salvar.');
        throw err;
      }
    },
    [refreshViewed],
  );

  const deleteIncome = useCallback(
    async (id: string) => {
      try {
        await fetchJSON(`/api/budget/incomes/${encodeURIComponent(id)}`, { method: 'DELETE' });
        await refreshViewed();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Não foi possível remover a renda.');
        throw err;
      }
    },
    [refreshViewed],
  );

  return {
    month,
    months,
    settings,
    bankSpent,
    bankSpentReady,
    loading,
    error,
    clearError,
    isLatest,
    canGoPrev,
    canGoNext,
    goToPrevMonth,
    goToNextMonth,
    reload,
    createNextMonth,
    updateSave,
    addCategory,
    updateCategory,
    deleteCategory,
    addIncome,
    updateIncome,
    deleteIncome,
  };
}
