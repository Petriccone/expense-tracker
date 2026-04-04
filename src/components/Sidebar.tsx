'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Receipt,
  Tags,
  BarChart3,
  Bot,
  Settings,
  Wallet,
  Upload,
  LogOut,
  Target,
} from 'lucide-react';

const navItems = [
  { href: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/transactions', icon: Receipt, label: 'Transactions' },
  { href: '/categories', icon: Tags, label: 'Categories' },
  { href: '/budget', icon: Target, label: 'Budget' },
  { href: '/reports', icon: BarChart3, label: 'Reports' },
  { href: '/import', icon: Upload, label: 'Import' },
  { href: '/ai', icon: Bot, label: 'AI Assistant' },
  { href: '/settings', icon: Settings, label: 'Settings' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user');
    router.push('/login');
  };

  return (
    <aside
      style={{
        display: 'none',
        position: 'fixed',
        left: 0,
        top: 0,
        width: 240,
        height: '100vh',
        zIndex: 50,
        flexDirection: 'column',
        background: '#fff',
        borderRight: '1px solid #e2e8f0',
      }}
      className="sidebar-desktop"
    >
      <style>{`@media(min-width:768px){.sidebar-desktop{display:flex!important}}`}</style>

      {/* Logo */}
      <div style={{ padding: '1.5rem', borderBottom: '1px solid #f1f5f9' }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', textDecoration: 'none' }}>
          <div style={{ width: 40, height: 40, background: 'linear-gradient(135deg, #7C3AED, #A78BFA)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Wallet style={{ width: 20, height: 20, color: '#fff' }} />
          </div>
          <div>
            <div style={{ fontWeight: 700, color: '#0f172a' }}>ExpenseAI</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>Smart Tracker</div>
          </div>
        </Link>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '1rem', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '0.75rem 1rem',
                borderRadius: 12,
                textDecoration: 'none',
                transition: 'all 0.2s',
                background: isActive ? '#f3f0ff' : 'transparent',
                color: isActive ? '#6d28d9' : '#475569',
                fontWeight: isActive ? 600 : 400,
              }}
            >
              <item.icon style={{ width: 20, height: 20, color: isActive ? '#7c3aed' : undefined }} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Logout */}
      <div style={{ padding: '1rem', borderTop: '1px solid #f1f5f9' }}>
        <button
          onClick={handleLogout}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '0.75rem 1rem',
            borderRadius: 12,
            border: 'none',
            background: 'transparent',
            color: '#475569',
            cursor: 'pointer',
            fontSize: 14,
          }}
        >
          <LogOut style={{ width: 20, height: 20 }} />
          <span>Logout</span>
        </button>
      </div>
    </aside>
  );
}
