'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { AppProvider } from '@/context/AppContext';
import { LayoutDashboard, Receipt, Tags, BarChart3, Bot, Settings, Upload, Target } from 'lucide-react';

const sidebarItems = [
  { href: '/', icon: LayoutDashboard, label: 'Home' },
  { href: '/transactions', icon: Receipt, label: 'Transactions' },
  { href: '/categories', icon: Tags, label: 'Categories' },
  { href: '/budget', icon: Target, label: 'Budget' },
  { href: '/reports', icon: BarChart3, label: 'Reports' },
  { href: '/import', icon: Upload, label: 'Import' },
  { href: '/ai', icon: Bot, label: 'AI' },
  { href: '/settings', icon: Settings, label: 'Settings' },
];

const mobileNavItems = [
  { href: '/', icon: LayoutDashboard, label: 'Home' },
  { href: '/transactions', icon: Receipt, label: 'Tx' },
  { href: '/budget', icon: Target, label: 'Budget' },
  { href: '/import', icon: Upload, label: 'Import' },
  { href: '/ai', icon: Bot, label: 'AI' },
];

function Sidebar() {
  const pathname = usePathname();
  return (
    <aside style={{
      width: 240, minHeight: '100vh', background: '#fff',
      borderRight: '1px solid #e2e8f0', padding: '20px 12px',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px 20px', borderBottom: '1px solid #f1f5f9', marginBottom: 12 }}>
        <span style={{ background: 'linear-gradient(135deg,#7C3AED,#A78BFA)', borderRadius: 10, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 16 }}>💰</span>
        <span style={{ fontWeight: 700, fontSize: 18, color: '#0f172a' }}>ExpenseAI</span>
      </div>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {sidebarItems.map(({ href, icon: Icon, label }) => {
          const active = pathname === href;
          return (
            <Link key={href} href={href} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 12px', borderRadius: 10,
              textDecoration: 'none', fontSize: 14,
              background: active ? '#f3f0ff' : 'transparent',
              color: active ? '#6d28d9' : '#475569',
              fontWeight: active ? 600 : 400,
            }}>
              <Icon size={20} />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

function MobileBottomNav() {
  const pathname = usePathname();
  return (
    <nav style={{
      background: '#fff', borderTop: '1px solid #e2e8f0',
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', height: 64 }}>
        {mobileNavItems.map(({ href, icon: Icon, label }) => {
          const active = pathname === href;
          return (
            <Link key={href} href={href} style={{
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              flex: 1, textDecoration: 'none',
              color: active ? '#7c3aed' : '#94a3b8',
              fontSize: 11, fontWeight: 500,
            }}>
              <div style={{ padding: 6, borderRadius: 10, background: active ? '#f3f0ff' : 'transparent' }}>
                <Icon size={20} />
              </div>
              <span style={{ marginTop: 2 }}>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export default function LayoutShell({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setReady(true);
    const mq = window.matchMedia('(min-width: 768px)');
    setIsDesktop(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  if (!ready) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
        <div style={{ width: 32, height: 32, border: '3px solid #e2e8f0', borderTopColor: '#7c3aed', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  if (pathname === '/login') {
    return <AppProvider>{children}</AppProvider>;
  }

  /* Desktop: sidebar on left + scrollable content */
  if (isDesktop) {
    return (
      <AppProvider>
        <div style={{ display: 'flex', minHeight: '100vh', background: '#f8fafc' }}>
          <Sidebar />
          <main style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
            <div style={{ maxWidth: 1080, margin: '0 auto' }}>
              {children}
            </div>
          </main>
        </div>
      </AppProvider>
    );
  }

  /* Mobile: flex column — header, scrollable content, bottom nav (NO position:fixed) */
  return (
    <AppProvider>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: '#f8fafc' }}>
        <header style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '12px 16px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ background: 'linear-gradient(135deg,#7C3AED,#A78BFA)', borderRadius: 10, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14 }}>💰</span>
            <span style={{ fontWeight: 700, fontSize: 17, color: '#0f172a' }}>ExpenseAI</span>
          </div>
        </header>
        <main style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: 16 }}>
          {children}
        </main>
        <MobileBottomNav />
      </div>
    </AppProvider>
  );
}
