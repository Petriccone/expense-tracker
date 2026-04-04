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
      <div style={{ display: 'flex', minHeight: '100vh' }}>
        <Sidebar />
        <main className="main-content" style={{ flex: 1, paddingBottom: 80 }}>
          <style>{`@media(min-width:768px){.main-content{margin-left:240px!important;padding-bottom:0!important}}`}</style>
          <div style={{ maxWidth: 1280, margin: '0 auto', padding: '1rem' }}>
            {children}
          </div>
        </main>
        <MobileNav />
      </div>
    </AppProvider>
  );
}
