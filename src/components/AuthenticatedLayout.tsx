'use client';

import { useEffect, useState, ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';

export default function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    
    // Login page - allow access
    if (pathname === '/login') {
      if (token) {
        router.push('/');
      }
      setLoading(false);
      return;
    }

    // All other pages - require auth
    if (!token) {
      router.push('/login');
    } else {
      setLoading(false);
    }
  }, [pathname, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  // Don't render wrapper on login page - let the page handle its own layout
  if (pathname === '/login') {
    return <>{children}</>;
  }

  return <>{children}</>;
}