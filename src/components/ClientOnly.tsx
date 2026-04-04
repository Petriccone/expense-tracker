'use client';

import dynamic from 'next/dynamic';

const LayoutShell = dynamic(() => import('@/components/LayoutShell'), {
  ssr: false,
  loading: () => (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 32, height: 32, border: '3px solid #E2E8F0', borderTopColor: '#7C3AED', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  ),
});

export default function ClientOnly({ children }: { children: React.ReactNode }) {
  return <LayoutShell>{children}</LayoutShell>;
}
