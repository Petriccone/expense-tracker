'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Receipt, Upload, Bot, Target } from 'lucide-react';

const navItems = [
  { href: '/', icon: LayoutDashboard, label: 'Home' },
  { href: '/transactions', icon: Receipt, label: 'Tx' },
  { href: '/budget', icon: Target, label: 'Budget' },
  { href: '/import', icon: Upload, label: 'Import' },
  { href: '/ai', icon: Bot, label: 'AI' },
];

export default function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="app-mobilenav">
      <style>{`
        .app-mobilenav {
          position: fixed;
          bottom: 0; left: 0; right: 0;
          background: #fff;
          border-top: 1px solid #e2e8f0;
          z-index: 50;
          padding-bottom: env(safe-area-inset-bottom, 0px);
        }
        @media (min-width: 768px) {
          .app-mobilenav { display: none !important; }
        }
        .mobilenav-item {
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          flex: 1; height: 64px;
          text-decoration: none;
          font-size: 11px; font-weight: 500;
        }
        .mobilenav-item.active { color: #7c3aed; }
        .mobilenav-item:not(.active) { color: #94a3b8; }
      `}</style>
      <div style={{ display: 'flex' }}>
        {navItems.map(({ href, icon: Icon, label }) => (
          <Link key={href} href={href} className={`mobilenav-item ${pathname === href ? 'active' : ''}`}>
            <div style={{ padding: 6, borderRadius: 10, background: pathname === href ? '#f3f0ff' : 'transparent' }}>
              <Icon size={20} />
            </div>
            <span style={{ marginTop: 2 }}>{label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
