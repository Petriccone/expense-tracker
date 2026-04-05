'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { AppProvider } from '@/context/AppContext';
import { LayoutDashboard, Receipt, Tags, BarChart3, Bot, Settings, Upload, Target, Menu, X, LogOut } from 'lucide-react';

const sidebarItems = [
  { href: '/', icon: LayoutDashboard, label: 'Início' },
  { href: '/transactions', icon: Receipt, label: 'Transações' },
  { href: '/categories', icon: Tags, label: 'Categorias' },
  { href: '/budget', icon: Target, label: 'Orçamento' },
  { href: '/reports', icon: BarChart3, label: 'Relatórios' },
  { href: '/import', icon: Upload, label: 'Importar' },
  { href: '/ai', icon: Bot, label: 'IA' },
  { href: '/settings', icon: Settings, label: 'Configurações' },
];

const mobileNavItems = [
  { href: '/', icon: LayoutDashboard, label: 'Início' },
  { href: '/transactions', icon: Receipt, label: 'Tx' },
  { href: '/budget', icon: Target, label: 'Orçamento' },
  { href: '/import', icon: Upload, label: 'Importar' },
  { href: '/ai', icon: Bot, label: 'IA' },
];

const mobileMenuItems = [
  { href: '/categories', icon: Tags, label: 'Categorias' },
  { href: '/reports', icon: BarChart3, label: 'Relatórios' },
  { href: '/settings', icon: Settings, label: 'Configurações' },
];

function applyThemeClass(darkMode: boolean) {
  if (darkMode) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

function getStoredDarkMode(): boolean {
  try {
    // Try user-specific storage key first
    let storageKey = 'expense-tracker-data';
    const userStr = localStorage.getItem('user');
    if (userStr) {
      const user = JSON.parse(userStr);
      if (user && user.id) {
        storageKey = 'expense-tracker-data-' + user.id;
      }
    }
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.settings && typeof parsed.settings.darkMode === 'boolean') {
        return parsed.settings.darkMode;
      }
    }
  } catch {
    // ignore
  }
  return false;
}

function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [userName, setUserName] = useState('');

  useEffect(() => {
    try {
      const userStr = localStorage.getItem('user');
      if (userStr) {
        const user = JSON.parse(userStr);
        setUserName(user.name || user.email || '');
      }
    } catch { /* ignore */ }
  }, []);

  const handleSair = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user');
    router.push('/login');
  };

  return (
    <aside style={{
      width: 260, minHeight: '100vh',
      background: 'var(--sidebar-bg)',
      backdropFilter: 'blur(24px)',
      WebkitBackdropFilter: 'blur(24px)',
      borderRight: '1px solid var(--border-color)',
      padding: '20px 14px',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Logo */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '4px 12px 24px',
        borderBottom: '1px solid var(--border-color)', marginBottom: 16,
      }}>
        <img src="/expense-tracker/icon.svg" alt="ExpensesAI" style={{
          width: 40, height: 40, borderRadius: 14,
          boxShadow: '0 0 20px rgba(124, 58, 237, 0.3)',
        }} />
        <span style={{
          fontWeight: 700, fontSize: 20,
          background: 'linear-gradient(135deg, #7C3AED, #06B6D4)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}>
          ExpensesAI
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
              color: active ? '#c4b5fd' : 'var(--inactive-color)',
              fontWeight: active ? 600 : 400,
              border: active ? '1px solid rgba(124, 58, 237, 0.2)' : '1px solid transparent',
              boxShadow: active ? '0 0 20px rgba(124, 58, 237, 0.1)' : 'none',
              transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
            }}>
              <Icon size={20} style={{
                color: active ? '#a78bfa' : 'var(--inactive-icon)',
                filter: active ? 'drop-shadow(0 0 6px rgba(124, 58, 237, 0.4))' : 'none',
              }} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* User info + logout */}
      <div style={{ marginTop: 'auto', padding: '16px 12px 0' }}>
        <div style={{
          height: 2,
          background: 'linear-gradient(90deg, #7C3AED, #06B6D4, transparent)',
          borderRadius: 1,
          opacity: 0.4,
          marginBottom: 16,
        }} />
        {userName && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 12px', marginBottom: 8,
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              background: 'linear-gradient(135deg, rgba(124, 58, 237, 0.3), rgba(6, 182, 212, 0.2))',
              border: '1px solid rgba(124, 58, 237, 0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, fontWeight: 600, color: '#c4b5fd',
            }}>
              {userName.charAt(0).toUpperCase()}
            </div>
            <span style={{
              fontSize: 13, fontWeight: 500,
              color: 'var(--text-secondary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {userName}
            </span>
          </div>
        )}
        <button
          onClick={handleSair}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 14px', borderRadius: 12,
            width: '100%', border: 'none', cursor: 'pointer',
            background: 'rgba(239, 68, 68, 0.08)',
            color: '#f87171', fontSize: 14, fontWeight: 500,
            transition: 'all 0.2s',
          }}
        >
          <LogOut size={18} />
          Sair
        </button>
      </div>
    </aside>
  );
}

function MobileBottomNav() {
  const pathname = usePathname();
  const [tapped, setTapped] = useState<string | null>(null);

  const handleTap = (href: string) => {
    setTapped(href);
    setTimeout(() => setTapped(null), 200);
  };

  return (
    <nav style={{
      background: 'var(--nav-bg)',
      backdropFilter: 'blur(24px)',
      WebkitBackdropFilter: 'blur(24px)',
      borderTop: '1px solid var(--border-color)',
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', height: 68 }}>
        {mobileNavItems.map(({ href, icon: Icon, label }) => {
          const active = pathname === href;
          const isTapped = tapped === href;
          return (
            <Link key={href} href={href} onClick={() => handleTap(href)} style={{
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              flex: 1, textDecoration: 'none',
              color: active ? '#c4b5fd' : 'var(--inactive-icon)',
              fontSize: 11, fontWeight: 500,
              transition: 'all 0.15s',
              transform: isTapped ? 'scale(0.85)' : 'scale(1)',
            }}>
              <div style={{
                padding: 8, borderRadius: 14,
                background: isTapped
                  ? 'linear-gradient(135deg, rgba(124, 58, 237, 0.35), rgba(6, 182, 212, 0.2))'
                  : active
                    ? 'linear-gradient(135deg, rgba(124, 58, 237, 0.2), rgba(6, 182, 212, 0.1))'
                    : 'transparent',
                boxShadow: isTapped
                  ? '0 0 24px rgba(124, 58, 237, 0.4)'
                  : active ? '0 0 16px rgba(124, 58, 237, 0.25)' : 'none',
                transition: 'all 0.15s',
              }}>
                <Icon size={20} style={{
                  filter: (active || isTapped) ? 'drop-shadow(0 0 6px rgba(124, 58, 237, 0.5))' : 'none',
                  transition: 'filter 0.15s',
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [userName, setUserName] = useState('');
  const pathname = usePathname();
  const router = useRouter();

  // Load user info
  useEffect(() => {
    try {
      const userStr = localStorage.getItem('user');
      if (userStr) {
        const user = JSON.parse(userStr);
        setUserName(user.name || user.email || '');
      }
    } catch { /* ignore */ }
    setAuthChecked(true);
  }, []);

  useEffect(() => {
    // Apply theme class before rendering
    const darkMode = getStoredDarkMode();
    applyThemeClass(darkMode);

    setReady(true);
    const mq = window.matchMedia('(min-width: 768px)');
    setIsDesktop(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Listen for theme changes from settings
  useEffect(() => {
    const handleStorage = () => {
      const darkMode = getStoredDarkMode();
      applyThemeClass(darkMode);
    };
    window.addEventListener('storage', handleStorage);
    // Also listen for custom event dispatched from settings
    window.addEventListener('theme-change', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('theme-change', handleStorage);
    };
  }, []);

  if (!ready || !authChecked) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg-base)',
      }}>
        <div style={{
          width: 36, height: 36,
          border: '3px solid var(--border-color)',
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
        <div className="mesh-bg" style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-base)' }}>
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

  /* Mobile: pull-to-refresh state */
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const touchStartY = useRef(0);
  const isPulling = useRef(false);
  const mainRef = useRef<HTMLElement>(null);
  const PULL_THRESHOLD = 80;

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (refreshing) return;
    const el = mainRef.current;
    if (el && el.scrollTop <= 0) {
      touchStartY.current = e.touches[0].clientY;
      isPulling.current = true;
    }
  }, [refreshing]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isPulling.current || refreshing) return;
    const el = mainRef.current;
    if (!el || el.scrollTop > 0) {
      isPulling.current = false;
      setPullDistance(0);
      return;
    }
    const diff = e.touches[0].clientY - touchStartY.current;
    if (diff > 0) {
      // Dampen the pull distance for a natural feel
      setPullDistance(Math.min(diff * 0.5, 120));
    }
  }, [refreshing]);

  const onTouchEnd = useCallback(() => {
    if (!isPulling.current) return;
    isPulling.current = false;
    if (pullDistance >= PULL_THRESHOLD && !refreshing) {
      setRefreshing(true);
      setPullDistance(PULL_THRESHOLD * 0.5);
      // Small delay so the user sees the spinner before reload
      setTimeout(() => window.location.reload(), 300);
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, refreshing]);

  /* Mobile: flex column */
  return (
    <AppProvider>
      <div className="mesh-bg" style={{
        display: 'flex', flexDirection: 'column', height: '100dvh', background: 'var(--bg-base)',
      }}>
        <header style={{
          background: 'var(--nav-bg)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderBottom: '1px solid var(--border-color)',
          padding: '12px 16px',
          paddingTop: 'max(12px, env(safe-area-inset-top))',
          flexShrink: 0,
          position: 'relative',
          zIndex: 100,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <img src="/expense-tracker/icon.svg" alt="ExpensesAI" style={{
                width: 34, height: 34, borderRadius: 12,
                boxShadow: '0 0 16px rgba(124, 58, 237, 0.3)',
              }} />
              <span style={{
                fontWeight: 700, fontSize: 18,
                background: 'linear-gradient(135deg, #7C3AED, #06B6D4)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}>
                ExpensesAI
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {userName && (
                <div style={{
                  width: 30, height: 30, borderRadius: '50%',
                  background: 'linear-gradient(135deg, rgba(124, 58, 237, 0.3), rgba(6, 182, 212, 0.2))',
                  border: '1px solid rgba(124, 58, 237, 0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 600, color: '#c4b5fd',
                }}>
                  {userName.charAt(0).toUpperCase()}
                </div>
              )}
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-secondary)', padding: 6, borderRadius: 10,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {menuOpen ? <X size={22} /> : <Menu size={22} />}
              </button>
            </div>
          </div>
          {menuOpen && (
            <div style={{
              position: 'absolute', top: '100%', right: 12,
              background: 'var(--menu-bg)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
              border: '1px solid var(--glass-border)',
              borderRadius: 16, padding: 8, minWidth: 180,
              boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
              animation: 'slideUp 0.2s ease-out',
            }}>
              {mobileMenuItems.map(({ href, icon: Icon, label }) => {
                const active = pathname === href;
                return (
                  <Link key={href} href={href} onClick={() => setMenuOpen(false)} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 14px', borderRadius: 12,
                    textDecoration: 'none', fontSize: 14,
                    color: active ? '#c4b5fd' : 'var(--inactive-color)',
                    fontWeight: active ? 600 : 400,
                    background: active ? 'rgba(124, 58, 237, 0.12)' : 'transparent',
                  }}>
                    <Icon size={18} style={{ color: active ? '#a78bfa' : 'var(--inactive-icon)' }} />
                    {label}
                  </Link>
                );
              })}
              <div style={{
                height: 1,
                background: 'var(--border-color)',
                margin: '4px 14px',
              }} />
              <button
                onClick={() => {
                  setMenuOpen(false);
                  localStorage.removeItem('auth_token');
                  localStorage.removeItem('user');
                  router.push('/login');
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 14px', borderRadius: 12,
                  width: '100%', border: 'none', cursor: 'pointer',
                  background: 'transparent',
                  color: '#f87171', fontSize: 14, fontWeight: 500,
                }}
              >
                <LogOut size={18} />
                Sair
              </button>
            </div>
          )}
        </header>
        <main
          ref={mainRef}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          style={{
            flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch',
            padding: 16, position: 'relative', zIndex: 1,
          }}
        >
          {/* Pull-to-refresh indicator */}
          {(pullDistance > 0 || refreshing) && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              height: pullDistance,
              transition: isPulling.current ? 'none' : 'height 0.25s ease-out',
              overflow: 'hidden',
              marginBottom: 8,
            }}>
              <div style={{
                width: 28, height: 28,
                border: '3px solid var(--border-color)',
                borderTopColor: pullDistance >= PULL_THRESHOLD || refreshing ? '#7C3AED' : 'var(--border-color)',
                borderRadius: '50%',
                animation: refreshing ? 'spin 0.6s linear infinite' : 'none',
                transform: refreshing ? 'none' : `rotate(${pullDistance * 3}deg)`,
                opacity: Math.min(pullDistance / 40, 1),
                transition: refreshing ? 'none' : 'opacity 0.1s',
                boxShadow: pullDistance >= PULL_THRESHOLD || refreshing
                  ? '0 0 12px rgba(124, 58, 237, 0.4)'
                  : 'none',
              }} />
            </div>
          )}
          {children}
        </main>
        <MobileBottomNav />
      </div>
    </AppProvider>
  );
}
