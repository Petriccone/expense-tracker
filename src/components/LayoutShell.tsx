'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { AppProvider } from '@/context/AppContext';
import Sidebar from '@/components/Sidebar';
import MobileNav from '@/components/MobileNav';

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

  const isLogin = pathname === '/login';

  if (isLogin) {
    return <AppProvider>{children}</AppProvider>;
  }

  return (
    <AppProvider>
      <Sidebar />
      <main style={{ marginLeft: 0, minHeight: '100vh', paddingBottom: 80, background: '#f8fafc' }}>
        <style>{`@media(min-width:768px){main{margin-left:240px!important;padding-bottom:0!important}}`}</style>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: 16 }}>
          {children}
        </div>
      </main>
      <MobileNav />
    </AppProvider>
  );
}
