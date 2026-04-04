'use client';

import { usePathname } from 'next/navigation';
import { AppProvider } from '@/context/AppContext';
import Sidebar from '@/components/Sidebar';
import MobileNav from '@/components/MobileNav';

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
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="flex-1 ml-0 md:ml-60 pb-20 md:pb-0">
          <div className="max-w-7xl mx-auto p-4 md:p-8">
            {children}
          </div>
        </main>
        <MobileNav />
      </div>
    </AppProvider>
  );
}
