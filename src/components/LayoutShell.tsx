'use client';

import { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { AppProvider } from '@/context/AppContext';
import { LayoutDashboard, Receipt, Tags, BarChart3, Bot, Settings, Upload, Target, Menu, X } from 'lucide-react';

const navItems = [
  { href: '/', icon: LayoutDashboard, label: 'Home' },
  { href: '/transactions', icon: Receipt, label: 'Transactions' },
  { href: '/categories', icon: Tags, label: 'Categories' },
  { href: '/budget', icon: Target, label: 'Budget' },
  { href: '/reports', icon: BarChart3, label: 'Reports' },
  { href: '/import', icon: Upload, label: 'Import' },
  { href: '/ai', icon: Bot, label: 'AI' },
  { href: '/settings', icon: Settings, label: 'Settings' },
];

function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <header style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '12px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: 1280, margin: '0 auto' }}>
        <a href="/" onClick={(e) => { e.preventDefault(); router.push('/'); }} style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: '#0f172a', fontWeight: 700, fontSize: 18 }}>
          <span style={{ background: 'linear-gradient(135deg,#7C3AED,#A78BFA)', borderRadius: 10, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 16 }}>💰</span>
          ExpenseAI
        </a>
        <button onClick={() => setOpen(!open)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 8, color: '#475569' }}>
          {open ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {open && (
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 12, paddingTop: 12, borderTop: '1px solid #f1f5f9' }}>
          {navItems.map(({ href, icon: Icon, label }) => {
            const active = pathname === href;
            return (
              <a
                key={href}
                href={href}
                onClick={(e) => { e.preventDefault(); router.push(href); setOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 12px', borderRadius: 10,
                  textDecoration: 'none', fontSize: 15,
                  background: active ? '#f3f0ff' : 'transparent',
                  color: active ? '#6d28d9' : '#475569',
                  fontWeight: active ? 600 : 400,
                }}
              >
                <Icon size={20} />
                {label}
              </a>
            );
          })}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              localStorage.removeItem('auth_token');
              localStorage.removeItem('user');
              router.push('/login');
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10, textDecoration: 'none', fontSize: 15, color: '#ef4444', marginTop: 4, borderTop: '1px solid #f1f5f9', paddingTop: 16 }}
          >
            Logout
          </a>
        </nav>
      )}
    </header>
  );
}

export default function LayoutShell({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const pathname = usePathname();

  useEffect(() => { setReady(true); }, []);

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

  return (
    <AppProvider>
      <div style={{ minHeight: '100vh', background: '#f8fafc' }}>
        <Nav />
        <main style={{ maxWidth: 1280, margin: '0 auto', padding: 16 }}>
          {children}
        </main>
      </div>
    </AppProvider>
  );
}
