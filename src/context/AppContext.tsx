'use client';

import React, { createContext, useContext, useReducer, useEffect, useState, useCallback, useRef, ReactNode } from 'react';
import { Transaction, Category, Settings, AIInsight, CategoryBudget } from '@/types';
import { supabase } from '@/lib/supabase';
import seedData from '../../public/seed-data.json';
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
  darkMode: false,
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

function getStorageKey(): string {
  try {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      const user = JSON.parse(userStr);
      if (user && user.id) {
        return 'expense-tracker-data-' + user.id;
      }
    }
  } catch {
    // ignore
  }
  return 'expense-tracker-data';
}

const LINK_TOKEN_KEY = 'telegram-link-token';
const DEFAULT_LINK_TOKEN = 'nDV8UVVnOIHmrJNEIvIlfn6n2CzJL2VA';

// Helper: fetch Telegram transactions from Supabase
async function fetchSupabaseTransactions(linkToken: string): Promise<Transaction[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('link_token', linkToken)
      .eq('source', 'telegram');

    if (error) {
      console.error('Supabase fetch error:', error);
      return [];
    }

    return (data || []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      type: row.type as 'income' | 'expense',
      amount: Number(row.amount),
      description: row.description as string,
      category: row.category as string,
      date: row.date as string,
      notes: (row.notes as string) || undefined,
      createdAt: row.created_at as string,
    }));
  } catch (err) {
    console.error('Supabase fetch failed:', err);
    return [];
  }
}

// Helper: merge transactions by id (dedup)
function mergeTransactions(local: Transaction[], remote: Transaction[]): Transaction[] {
  const map = new Map<string, Transaction>();
  for (const t of local) map.set(t.id, t);
  for (const t of remote) {
    if (!map.has(t.id)) map.set(t.id, t);
  }
  return Array.from(map.values());
}

// Helper: save a transaction to Supabase
async function saveTransactionToSupabase(t: Transaction, linkToken: string, source: string = 'web') {
  if (!supabase) return;
  try {
    await supabase.from('transactions').upsert({
      id: t.id,
      link_token: linkToken,
      type: t.type,
      amount: t.amount,
      description: t.description,
      category: t.category,
      date: t.date,
      notes: t.notes || null,
      source,
      created_at: t.createdAt,
    });
  } catch (err) {
    console.error('Supabase save failed:', err);
  }
}

// Helper: delete a transaction from Supabase
async function deleteTransactionFromSupabase(id: string) {
  if (!supabase) return;
  try {
    await supabase.from('transactions').delete().eq('id', id);
  } catch (err) {
    console.error('Supabase delete failed:', err);
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const [loaded, setLoaded] = useState(false);
  const lastSyncRef = useRef<string | null>(null);
  const syncedIdsRef = useRef<Set<string>>(new Set());

  // Load from localStorage on mount, seed Budget.xlsx data if no transactions
  useEffect(() => {
    const storageKey = getStorageKey();
    const stored = localStorage.getItem(storageKey);
    let loadedTransactions: Transaction[] = [];
    let parsedSettings = defaultSettings;
    let parsedCategories = defaultCategories;
    let parsedBudgets: CategoryBudget[] = [];

    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        loadedTransactions = parsed.transactions || [];
        parsedCategories = parsed.categories || defaultCategories;
        parsedSettings = { ...defaultSettings, ...parsed.settings };
        parsedBudgets = parsed.categoryBudgets || [];
        // Restore link token if saved
        if (parsed.linkToken && !localStorage.getItem(LINK_TOKEN_KEY)) {
          localStorage.setItem(LINK_TOKEN_KEY, parsed.linkToken);
        }
        // Ensure link token always exists
        if (!localStorage.getItem(LINK_TOKEN_KEY)) {
          localStorage.setItem(LINK_TOKEN_KEY, DEFAULT_LINK_TOKEN);
        }
      } catch (e) {
        console.error('Failed to load from localStorage', e);
      }
    }

    // If no transactions found, use seed data from Budget.xlsx
    if (loadedTransactions.length === 0) {
      loadedTransactions = (seedData as unknown as Transaction[]) || [];
      parsedCategories = (seedCategories as unknown as Category[]) || defaultCategories;
      parsedBudgets = (seedBudgets as unknown as CategoryBudget[]) || [];
    }

    // Always ensure link token exists
    if (!localStorage.getItem(LINK_TOKEN_KEY)) {
      localStorage.setItem(LINK_TOKEN_KEY, DEFAULT_LINK_TOKEN);
    }

    // Attempt Supabase merge on mount
    const linkToken = localStorage.getItem(LINK_TOKEN_KEY);
    if (linkToken && supabase) {
      const localTx = loadedTransactions;
      fetchSupabaseTransactions(linkToken).then((remoteTx) => {
        const merged = mergeTransactions(localTx, remoteTx);
        dispatch({
          type: 'LOAD_STATE',
          payload: {
            ...initialState,
            transactions: merged,
            categories: parsedCategories,
            settings: parsedSettings,
            categoryBudgets: parsedBudgets,
          },
        });
        lastSyncRef.current = new Date().toISOString();
        setLoaded(true);
      });
    } else {
      dispatch({
        type: 'LOAD_STATE',
        payload: {
          ...initialState,
          transactions: loadedTransactions,
          categories: parsedCategories,
          settings: parsedSettings,
          categoryBudgets: parsedBudgets,
        },
      });
      setLoaded(true);
    }
  }, []);

  // Poll Supabase for new Telegram transactions + sync on app focus
  useEffect(() => {
    if (!loaded || !supabase) return;

    // Initialize synced IDs from current state
    const storedSync = localStorage.getItem(getStorageKey());
    if (storedSync) {
      try {
        const parsed = JSON.parse(storedSync);
        (parsed.transactions || []).forEach((t: Transaction) => syncedIdsRef.current.add(t.id));
      } catch { /* ignore */ }
    }

    const syncFromSupabase = async () => {
      const linkToken = localStorage.getItem(LINK_TOKEN_KEY);
      if (!linkToken) return;

      try {
        const remoteTx = await fetchSupabaseTransactions(linkToken);
        for (const tx of remoteTx) {
          if (!syncedIdsRef.current.has(tx.id)) {
            syncedIdsRef.current.add(tx.id);
            dispatch({ type: 'ADD_TRANSACTION', payload: tx });
          }
        }
      } catch (err) {
        console.error('Supabase poll error:', err);
      }
      lastSyncRef.current = new Date().toISOString();
    };

    // Poll every 15 seconds
    const interval = setInterval(syncFromSupabase, 15000);

    // Also sync when app comes back to focus (user switches back to the app)
    const handleFocus = () => syncFromSupabase();
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') syncFromSupabase();
    });

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  }, [loaded]);

  // Save to localStorage on state change (only after initial load)
  useEffect(() => {
    if (!loaded) return;
    const linkToken = localStorage.getItem(LINK_TOKEN_KEY) || '';
    localStorage.setItem(
      getStorageKey(),
      JSON.stringify({
        transactions: state.transactions,
        categories: state.categories,
        settings: state.settings,
        categoryBudgets: state.categoryBudgets,
        linkToken,
      })
    );
  }, [state.transactions, state.categories, state.settings, state.categoryBudgets, loaded]);

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
    // Also save to Supabase if linked
    const linkToken = localStorage.getItem(LINK_TOKEN_KEY);
    if (linkToken && supabase) {
      saveTransactionToSupabase(t, linkToken, 'web');
    }
  }, [dispatch]);

  const updateTransaction = useCallback((t: Transaction) => {
    dispatch({ type: 'UPDATE_TRANSACTION', payload: t });
    // Also update in Supabase if linked
    const linkToken = localStorage.getItem(LINK_TOKEN_KEY);
    if (linkToken && supabase) {
      saveTransactionToSupabase(t, linkToken, 'web');
    }
  }, [dispatch]);

  const deleteTransaction = useCallback((id: string) => {
    dispatch({ type: 'DELETE_TRANSACTION', payload: id });
    // Also delete from Supabase if linked
    if (supabase) {
      deleteTransactionFromSupabase(id);
    }
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
