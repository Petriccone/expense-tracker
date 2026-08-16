'use client';

import React, { createContext, useContext, useReducer, useEffect, useState, useCallback, ReactNode } from 'react';
import { Transaction, Category, Settings, AIInsight, CategoryBudget } from '@/types';
import seedBudgets from '../../public/seed-budgets.json';
import seedCategories from '../../public/seed-categories.json';

interface AppState {
  transactions: Transaction[];
  categories: Category[];
  settings: Settings;
  insights: AIInsight[];
  categoryBudgets: CategoryBudget[];
}

type Action =
  | { type: 'SET_TRANSACTIONS'; payload: Transaction[] }
  | { type: 'ADD_TRANSACTION'; payload: Transaction }
  | { type: 'UPDATE_TRANSACTION'; payload: Transaction }
  | { type: 'DELETE_TRANSACTION'; payload: string }
  | { type: 'SET_CATEGORIES'; payload: Category[] }
  | { type: 'ADD_CATEGORY'; payload: Category }
  | { type: 'UPDATE_CATEGORY'; payload: Category }
  | { type: 'DELETE_CATEGORY'; payload: string }
  | { type: 'SET_SETTINGS'; payload: Settings }
  | { type: 'SET_INSIGHTS'; payload: AIInsight[] }
  | { type: 'SET_CATEGORY_BUDGETS'; payload: CategoryBudget[] }
  | { type: 'UPDATE_CATEGORY_BUDGET'; payload: CategoryBudget }
  | { type: 'LOAD_STATE'; payload: AppState };

const defaultCategories: Category[] = [
  { id: '1', name: 'Food & Dining', icon: '🍔', color: '#EF4444', type: 'expense' },
  { id: '2', name: 'Transport', icon: '🚗', color: '#F59E0B', type: 'expense' },
  { id: '3', name: 'Housing', icon: '🏠', color: '#8B5CF6', type: 'expense' },
  { id: '4', name: 'Entertainment', icon: '🎬', color: '#EC4899', type: 'expense' },
  { id: '5', name: 'Shopping', icon: '🛍️', color: '#06B6D4', type: 'expense' },
  { id: '6', name: 'Health', icon: '💊', color: '#10B981', type: 'expense' },
  { id: '7', name: 'Education', icon: '📚', color: '#3B82F6', type: 'expense' },
  { id: '8', name: 'Bills & Utilities', icon: '💡', color: '#6366F1', type: 'expense' },
  { id: '9', name: 'Other', icon: '📦', color: '#64748B', type: 'expense' },
  { id: '10', name: 'Salary', icon: '💰', color: '#10B981', type: 'income' },
  { id: '11', name: 'Freelance', icon: '💻', color: '#22C55E', type: 'income' },
  { id: '12', name: 'Investment', icon: '📈', color: '#14B8A6', type: 'income' },
  { id: '13', name: 'Gift', icon: '🎁', color: '#F97316', type: 'income' },
  { id: '14', name: 'Other Income', icon: '💵', color: '#84CC16', type: 'income' },
];

const defaultSettings: Settings = {
  currency: 'EUR',
  monthlyBudget: 2000,
  darkMode: true,
};

const initialState: AppState = {
  transactions: [],
  categories: defaultCategories,
  settings: defaultSettings,
  insights: [],
  categoryBudgets: [],
};

function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_TRANSACTIONS':
      return { ...state, transactions: action.payload };
    case 'ADD_TRANSACTION':
      // Prevent duplicates
      if (state.transactions.some(t => t.id === action.payload.id)) return state;
      return { ...state, transactions: [action.payload, ...state.transactions] };
    case 'UPDATE_TRANSACTION':
      return {
        ...state,
        transactions: state.transactions.map((t) =>
          t.id === action.payload.id ? action.payload : t
        ),
      };
    case 'DELETE_TRANSACTION':
      return {
        ...state,
        transactions: state.transactions.filter((t) => t.id !== action.payload),
      };
    case 'SET_CATEGORIES':
      return { ...state, categories: action.payload };
    case 'ADD_CATEGORY':
      return { ...state, categories: [...state.categories, action.payload] };
    case 'UPDATE_CATEGORY':
      return {
        ...state,
        categories: state.categories.map((c) =>
          c.id === action.payload.id ? action.payload : c
        ),
      };
    case 'DELETE_CATEGORY':
      return {
        ...state,
        categories: state.categories.filter((c) => c.id !== action.payload),
      };
    case 'SET_SETTINGS':
      return { ...state, settings: action.payload };
    case 'SET_INSIGHTS':
      return { ...state, insights: action.payload };
    case 'SET_CATEGORY_BUDGETS':
      return { ...state, categoryBudgets: action.payload };
    case 'UPDATE_CATEGORY_BUDGET': {
      const exists = state.categoryBudgets.find((b) => b.categoryId === action.payload.categoryId);
      if (exists) {
        return {
          ...state,
          categoryBudgets: state.categoryBudgets.map((b) =>
            b.categoryId === action.payload.categoryId ? action.payload : b
          ),
        };
      }
      return { ...state, categoryBudgets: [...state.categoryBudgets, action.payload] };
    }
    case 'LOAD_STATE':
      return action.payload;
    default:
      return state;
  }
}

interface AppContextType {
  state: AppState;
  dispatch: React.Dispatch<Action>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const STORAGE_KEY = 'expense-tracker-data';
const LINK_TOKEN_KEY = 'telegram-link-token';
const DEFAULT_LINK_TOKEN = 'nDV8UVVnOIHmrJNEIvIlfn6n2CzJL2VA';
const TRANSACTIONS_POLL_MS = 60_000;

// Helper: load transactions from the read API (SQLite — bank sync via
// TrueLayer + manual entries), the app's single source of truth for
// transaction data. See docs/2026-08-14-m1-real-bank-autosync-design.md.
async function fetchApiTransactions(): Promise<Transaction[]> {
  try {
    const res = await fetch('/api/transactions?limit=1000');
    if (!res.ok) {
      console.error('Transactions fetch failed:', res.status);
      return [];
    }
    return (await res.json()) as Transaction[];
  } catch (err) {
    console.error('Transactions fetch failed:', err);
    return [];
  }
}

// Helper: persist a manually-added transaction (Add form, CSV import) to
// SQLite so it survives reload.
async function saveManualTransaction(t: Transaction) {
  try {
    await fetch('/api/transactions/manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(t),
    });
  } catch (err) {
    console.error('Manual transaction save failed:', err);
  }
}

async function updateManualTransactionApi(t: Transaction) {
  try {
    await fetch(`/api/transactions/manual/${encodeURIComponent(t.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(t),
    });
  } catch (err) {
    console.error('Manual transaction update failed:', err);
  }
}

async function deleteManualTransactionApi(id: string) {
  try {
    await fetch(`/api/transactions/manual/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (err) {
    console.error('Manual transaction delete failed:', err);
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const [loaded, setLoaded] = useState(false);

  // Load UI prefs (categories/settings/budgets) from localStorage on mount.
  // Transactions are NOT sourced from localStorage anymore — they load from
  // the read API below (bank sync + manual entries in SQLite).
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    let parsedSettings = defaultSettings;
    let parsedCategories = defaultCategories;
    let parsedBudgets: CategoryBudget[] = [];

    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        parsedCategories = parsed.categories || defaultCategories;
        parsedSettings = { ...defaultSettings, ...parsed.settings };
        // Migrate existing users to dark mode
        if (!localStorage.getItem('dark-mode-migrated')) {
          parsedSettings.darkMode = true;
          localStorage.setItem('dark-mode-migrated', '1');
        }
        parsedBudgets = parsed.categoryBudgets || [];
        // Restore link token if saved
        if (parsed.linkToken && !localStorage.getItem(LINK_TOKEN_KEY)) {
          localStorage.setItem(LINK_TOKEN_KEY, parsed.linkToken);
        }
      } catch (e) {
        console.error('Failed to load from localStorage', e);
      }
    } else {
      // First-ever visit: seed categories/budgets from Rafa's Budget.xlsx import.
      parsedCategories = (seedCategories as unknown as Category[]) || defaultCategories;
      parsedBudgets = (seedBudgets as unknown as CategoryBudget[]) || [];
    }

    // Always ensure link token exists
    if (!localStorage.getItem(LINK_TOKEN_KEY)) {
      localStorage.setItem(LINK_TOKEN_KEY, DEFAULT_LINK_TOKEN);
    }

    dispatch({
      type: 'LOAD_STATE',
      payload: {
        ...initialState,
        transactions: [],
        categories: parsedCategories,
        settings: parsedSettings,
        categoryBudgets: parsedBudgets,
      },
    });
    setLoaded(true);
  }, []);

  // Load transactions from the read API on mount, then refresh periodically
  // (replaces the old 15s Supabase/Telegram poll) + on focus, so a bank
  // auto-sync or a manual add from another tab shows up without a hard reload.
  useEffect(() => {
    if (!loaded) return;

    const refreshTransactions = async () => {
      const transactions = await fetchApiTransactions();
      dispatch({ type: 'SET_TRANSACTIONS', payload: transactions });
    };

    refreshTransactions();

    const interval = setInterval(refreshTransactions, TRANSACTIONS_POLL_MS);
    const handleFocus = () => refreshTransactions();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refreshTransactions();
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loaded]);

  // Save UI prefs to localStorage on change (only after initial load).
  // Transactions are persisted server-side (SQLite), not here.
  useEffect(() => {
    if (!loaded) return;
    const linkToken = localStorage.getItem(LINK_TOKEN_KEY) || '';
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        categories: state.categories,
        settings: state.settings,
        categoryBudgets: state.categoryBudgets,
        linkToken,
      })
    );
  }, [state.categories, state.settings, state.categoryBudgets, loaded]);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
}

export function useTransactions() {
  const { state, dispatch } = useApp();

  const addTransaction = useCallback((t: Transaction) => {
    dispatch({ type: 'ADD_TRANSACTION', payload: t });
    // Persist to SQLite (manual_transactions) so it survives reload.
    saveManualTransaction(t);
  }, [dispatch]);

  const updateTransaction = useCallback((t: Transaction) => {
    dispatch({ type: 'UPDATE_TRANSACTION', payload: t });
    updateManualTransactionApi(t);
  }, [dispatch]);

  const deleteTransaction = useCallback((id: string) => {
    dispatch({ type: 'DELETE_TRANSACTION', payload: id });
    deleteManualTransactionApi(id);
  }, [dispatch]);

  return { transactions: state.transactions, addTransaction, updateTransaction, deleteTransaction };
}

export function useCategories() {
  const { state, dispatch } = useApp();
  const addCategory = useCallback((c: Category) => dispatch({ type: 'ADD_CATEGORY', payload: c }), [dispatch]);
  const updateCategory = useCallback((c: Category) => dispatch({ type: 'UPDATE_CATEGORY', payload: c }), [dispatch]);
  const deleteCategory = useCallback((id: string) => dispatch({ type: 'DELETE_CATEGORY', payload: id }), [dispatch]);
  return { categories: state.categories, addCategory, updateCategory, deleteCategory };
}

export function useSettings() {
  const { state, dispatch } = useApp();
  const setSettings = useCallback((s: Settings) => dispatch({ type: 'SET_SETTINGS', payload: s }), [dispatch]);
  return { settings: state.settings, setSettings };
}

export function useInsights() {
  const { state, dispatch } = useApp();
  const setInsights = useCallback((i: AIInsight[]) => dispatch({ type: 'SET_INSIGHTS', payload: i }), [dispatch]);
  return { insights: state.insights, setInsights };
}

export function useCategoryBudgets() {
  const { state, dispatch } = useApp();
  const setCategoryBudgets = useCallback((b: CategoryBudget[]) => dispatch({ type: 'SET_CATEGORY_BUDGETS', payload: b }), [dispatch]);
  const updateCategoryBudget = useCallback((b: CategoryBudget) => dispatch({ type: 'UPDATE_CATEGORY_BUDGET', payload: b }), [dispatch]);
  return { categoryBudgets: state.categoryBudgets, setCategoryBudgets, updateCategoryBudget };
}
