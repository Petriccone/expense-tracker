'use client';

import React, { createContext, useContext, useReducer, useEffect, useState, ReactNode } from 'react';
import { Transaction, Category, Settings, AIInsight } from '@/types';

interface AppState {
  transactions: Transaction[];
  categories: Category[];
  settings: Settings;
  insights: AIInsight[];
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
};

function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_TRANSACTIONS':
      return { ...state, transactions: action.payload };
    case 'ADD_TRANSACTION':
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

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const [loaded, setLoaded] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        dispatch({
          type: 'LOAD_STATE',
          payload: {
            ...initialState,
            ...parsed,
            categories: parsed.categories || defaultCategories,
            settings: { ...defaultSettings, ...parsed.settings },
          },
        });
      } catch (e) {
        console.error('Failed to load from localStorage', e);
      }
    }
    setLoaded(true);
  }, []);

  // Save to localStorage on state change (only after initial load)
  useEffect(() => {
    if (!loaded) return;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        transactions: state.transactions,
        categories: state.categories,
        settings: state.settings,
      })
    );
  }, [state.transactions, state.categories, state.settings, loaded]);

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
  return {
    transactions: state.transactions,
    addTransaction: (t: Transaction) => dispatch({ type: 'ADD_TRANSACTION', payload: t }),
    updateTransaction: (t: Transaction) => dispatch({ type: 'UPDATE_TRANSACTION', payload: t }),
    deleteTransaction: (id: string) => dispatch({ type: 'DELETE_TRANSACTION', payload: id }),
  };
}

export function useCategories() {
  const { state, dispatch } = useApp();
  return {
    categories: state.categories,
    addCategory: (c: Category) => dispatch({ type: 'ADD_CATEGORY', payload: c }),
    updateCategory: (c: Category) => dispatch({ type: 'UPDATE_CATEGORY', payload: c }),
    deleteCategory: (id: string) => dispatch({ type: 'DELETE_CATEGORY', payload: id }),
  };
}

export function useSettings() {
  const { state, dispatch } = useApp();
  return {
    settings: state.settings,
    setSettings: (s: Settings) => dispatch({ type: 'SET_SETTINGS', payload: s }),
  };
}

export function useInsights() {
  const { state, dispatch } = useApp();
  return {
    insights: state.insights,
    setInsights: (i: AIInsight[]) => dispatch({ type: 'SET_INSIGHTS', payload: i }),
  };
}