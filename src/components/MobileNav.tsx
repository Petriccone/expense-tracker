'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Receipt,
  PlusCircle,
  Upload,
  BarChart3,
  Bot,
  Target,
} from 'lucide-react';

const navItems = [
  { href: '/', icon: LayoutDashboard, label: 'Home' },
  { href: '/transactions', icon: Receipt, label: 'Tx' },
  { href: '/add', icon: PlusCircle, label: 'Add' },
  { href: '/budget', icon: Target, label: 'Budget' },
  { href: '/ai', icon: Bot, label: 'AI' },
];

export default function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-50 pb-safe">
      <div className="flex justify-around items-center h-16">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center w-full h-full transition-colors ${
                isActive ? 'text-purple-600' : 'text-slate-400'
              }`}
            >
              <div className={`p-2 rounded-xl ${isActive ? 'bg-purple-50' : ''}`}>
                <item.icon className="w-5 h-5" />
              </div>
              <span className="text-xs mt-1 font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}