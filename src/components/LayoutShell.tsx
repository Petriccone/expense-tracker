'use client';

import { usePathname } from 'next/navigation';
import { AppProvider } from '@/context/AppContext';

const publicRoutes = ['/login', '/test'];

export default function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === '/test') {
    return <>{children}</>;
  }

  if (publicRoutes.includes(pathname)) {
    return <AppProvider>{children}</AppProvider>;
  }

  return (
    <AppProvider>
      <div style={{ padding: '1rem' }}>
        <nav style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <a href="/expense-tracker/" style={{ color: '#7C3AED', fontWeight: 'bold' }}>Home</a>
          <a href="/expense-tracker/transactions/" style={{ color: '#7C3AED' }}>Transactions</a>
          <a href="/expense-tracker/budget/" style={{ color: '#7C3AED' }}>Budget</a>
          <a href="/expense-tracker/add/" style={{ color: '#7C3AED' }}>Add</a>
          <a href="/expense-tracker/categories/" style={{ color: '#7C3AED' }}>Categories</a>
          <a href="/expense-tracker/reports/" style={{ color: '#7C3AED' }}>Reports</a>
          <a href="/expense-tracker/settings/" style={{ color: '#7C3AED' }}>Settings</a>
        </nav>
        {children}
      </div>
    </AppProvider>
  );
}
