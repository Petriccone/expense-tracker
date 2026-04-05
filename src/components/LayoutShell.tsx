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
      width: 260, minHeight: '100vh',
      background: 'rgba(10, 15, 30, 0.85)',
      backdropFilter: 'blur(24px)',
      WebkitBackdropFilter: 'blur(24px)',
      borderRight: '1px solid rgba(255, 255, 255, 0.06)',
      padding: '20px 14px',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Logo */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '4px 12px 24px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.06)', marginBottom: 16,
      }}>
        <span style={{
          background: 'linear-gradient(135deg, #7C3AED, #06B6D4)',
          borderRadius: 14, width: 40, height: 40,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: 18,
          boxShadow: '0 0 20px rgba(124, 58, 237, 0.3)',
        }}>
          💰
        </span>
        <span style={{
          fontWeight: 700, fontSize: 20,
          background: 'linear-gradient(135deg, #7C3AED, #06B6D4)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}>
          ExpenseAI
        </span>
      </div>

      {/* Nav Items */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {sidebarItems.map(({ href, icon: Icon, label }) => {
          const active = pathname === href;
          return (
            <Link key={href} href={href} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '11px 14px', borderRadius: 14,
              textDecoration: 'none', fontSize: 14,
              background: active
                ? 'linear-gradient(135deg, rgba(124, 58, 237, 0.15), rgba(6, 182, 212, 0.08))'
                : 'transparent',
              color: active ? '#c4b5fd' : '#8892a8',
              fontWeight: active ? 600 : 400,
              border: active ? '1px solid rgba(124, 58, 237, 0.2)' : '1px solid transparent',
              boxShadow: active ? '0 0 20px rgba(124, 58, 237, 0.1)' : 'none',
              transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
            }}>
              <Icon size={20} style={{
                color: active ? '#a78bfa' : '#5a6478',
                filter: active ? 'drop-shadow(0 0 6px rgba(124, 58, 237, 0.4))' : 'none',
              }} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Bottom accent line */}
      <div style={{ marginTop: 'auto', padding: '16px 12px 0' }}>
        <div style={{
          height: 2,
          background: 'linear-gradient(90deg, #7C3AED, #06B6D4, transparent)',
          borderRadius: 1,
          opacity: 0.4,
        }} />
      </div>
    </aside>
  );
}

function MobileBottomNav() {
  const pathname = usePathname();
  return (
    <nav style={{
      background: 'rgba(10, 15, 30, 0.92)',
      backdropFilter: 'blur(24px)',
      WebkitBackdropFilter: 'blur(24px)',
      borderTop: '1px solid rgba(255, 255, 255, 0.06)',
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', height: 68 }}>
        {mobileNavItems.map(({ href, icon: Icon, label }) => {
          const active = pathname === href;
          return (
            <Link key={href} href={href} style={{
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              flex: 1, textDecoration: 'none',
              color: active ? '#c4b5fd' : '#5a6478',
              fontSize: 11, fontWeight: 500,
              transition: 'all 0.25s',
            }}>
              <div style={{
                padding: 8, borderRadius: 14,
                background: active
                  ? 'linear-gradient(135deg, rgba(124, 58, 237, 0.2), rgba(6, 182, 212, 0.1))'
                  : 'transparent',
                boxShadow: active ? '0 0 16px rgba(124, 58, 237, 0.25)' : 'none',
                transition: 'all 0.25s',
              }}>
                <Icon size={20} style={{
                  filter: active ? 'drop-shadow(0 0 6px rgba(124, 58, 237, 0.5))' : 'none',
                }} />
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
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#0a0f1e',
      }}>
        <div style={{
          width: 36, height: 36,
          border: '3px solid rgba(255,255,255,0.06)',
          borderTopColor: '#7C3AED',
          borderRadius: '50%',
          animation: 'spin 0.6s linear infinite',
          boxShadow: '0 0 20px rgba(124, 58, 237, 0.3)',
        }} />
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
        <div className="mesh-bg" style={{ display: 'flex', minHeight: '100vh', background: '#0a0f1e' }}>
          <Sidebar />
          <main style={{ flex: 1, padding: 28, overflowY: 'auto', position: 'relative', zIndex: 1 }}>
            <div style={{ maxWidth: 1100, margin: '0 auto' }}>
              {children}
            </div>
          </main>
        </div>
      </AppProvider>
    );
  }

  /* Mobile: flex column */
  return (
    <AppProvider>
      <div className="mesh-bg" style={{
        display: 'flex', flexDirection: 'column', height: '100dvh', background: '#0a0f1e',
      }}>
        <header style={{
          background: 'rgba(10, 15, 30, 0.92)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
          padding: '12px 16px',
          paddingTop: 'max(12px, env(safe-area-inset-top))',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              background: 'linear-gradient(135deg, #7C3AED, #06B6D4)',
              borderRadius: 12, width: 34, height: 34,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 15,
              boxShadow: '0 0 16px rgba(124, 58, 237, 0.3)',
            }}>
              💰
            </span>
            <span style={{
              fontWeight: 700, fontSize: 18,
              background: 'linear-gradient(135deg, #7C3AED, #06B6D4)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}>
              ExpenseAI
            </span>
          </div>
        </header>
        <main style={{
          flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch',
          padding: 16, position: 'relative', zIndex: 1,
        }}>
          {children}
        </main>
        <MobileBottomNav />
      </div>
    </AppProvider>
  );
}
