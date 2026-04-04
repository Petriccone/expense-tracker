'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AppProvider } from '@/context/AppContext';
import Sidebar from '@/components/Sidebar';
import MobileNav from '@/components/MobileNav';

const publicRoutes = ['/login', '/test'];

export default function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isPublicRoute = publicRoutes.includes(pathname);

  // For public/test routes, render without any providers or navigation
  if (pathname === '/test') {
    return <>{children}</>;
  }

  // Show a simple loading state until client is mounted
  if (!mounted) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 32, height: 32, border: '3px solid #E2E8F0', borderTopColor: '#7C3AED', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (isPublicRoute) {
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
