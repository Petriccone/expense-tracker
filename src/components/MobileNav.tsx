'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Receipt,
  Upload,
  Bot,
  Target,
} from 'lucide-react';

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
    <nav
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        background: '#fff',
        borderTop: '1px solid #e2e8f0',
        zIndex: 50,
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
      className="mobilenav-wrapper"
    >
      <style>{`@media(min-width:768px){.mobilenav-wrapper{display:none!important}}`}</style>
      <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', height: 64 }}>
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                flex: 1,
                height: '100%',
                textDecoration: 'none',
                color: isActive ? '#7c3aed' : '#94a3b8',
              }}
            >
              <div style={{ padding: 8, borderRadius: 12, background: isActive ? '#f3f0ff' : 'transparent' }}>
                <item.icon style={{ width: 20, height: 20 }} />
              </div>
              <span style={{ fontSize: 11, marginTop: 4, fontWeight: 500 }}>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
