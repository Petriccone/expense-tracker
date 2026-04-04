'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, Receipt, Tags, BarChart3, Bot, Settings, Wallet, Upload, LogOut, Target } from 'lucide-react';

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

  return (
    <aside className="app-sidebar">
      <style>{`
        .app-sidebar {
          display: none;
        }
        @media (min-width: 768px) {
          .app-sidebar {
            display: flex !important;
            flex-direction: column;
            position: fixed;
            left: 0; top: 0;
            width: 240px;
            height: 100vh;
            background: #fff;
            border-right: 1px solid #e2e8f0;
            z-index: 50;
          }
        }
        .sidebar-link {
          display: flex; align-items: center; gap: 12px;
          padding: 10px 16px; border-radius: 12px;
          text-decoration: none; font-size: 14px;
          transition: background 0.15s;
        }
        .sidebar-link:hover { background: #f1f5f9; }
        .sidebar-link.active { background: #f3f0ff; color: #6d28d9; font-weight: 600; }
        .sidebar-link:not(.active) { color: #475569; }
      `}</style>

      <div style={{ padding: 24, borderBottom: '1px solid #f1f5f9' }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none' }}>
          <div style={{ width: 40, height: 40, background: 'linear-gradient(135deg,#7C3AED,#A78BFA)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Wallet size={20} color="#fff" />
          </div>
          <div>
            <div style={{ fontWeight: 700, color: '#0f172a' }}>ExpenseAI</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>Smart Tracker</div>
          </div>
        </Link>
      </div>

      <nav style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {navItems.map(({ href, icon: Icon, label }) => (
          <Link key={href} href={href} className={`sidebar-link ${pathname === href ? 'active' : ''}`}>
            <Icon size={20} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>

      <div style={{ padding: 16, borderTop: '1px solid #f1f5f9' }}>
        <button
          onClick={() => { localStorage.removeItem('auth_token'); localStorage.removeItem('user'); router.push('/login'); }}
          className="sidebar-link"
          style={{ width: '100%', border: 'none', background: 'none', cursor: 'pointer', fontSize: 14 }}
        >
          <LogOut size={20} />
          <span>Logout</span>
        </button>
      </div>
    </aside>
  );
}
