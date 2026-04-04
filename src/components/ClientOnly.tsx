'use client';

import dynamic from 'next/dynamic';
import React from 'react';

const LayoutShell = dynamic(() => import('@/components/LayoutShell'), {
  ssr: false,
  loading: () => (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 32, height: 32, border: '3px solid #E2E8F0', borderTopColor: '#7C3AED', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  ),
});

interface ErrorBoundaryState {
  error: Error | null;
}

class ErrorCatcher extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '2rem', fontFamily: 'monospace' }}>
          <h1 style={{ color: 'red', fontSize: '1.2rem' }}>App Error</h1>
          <pre style={{ whiteSpace: 'pre-wrap', background: '#fee', padding: '1rem', borderRadius: 8, fontSize: '0.8rem', overflow: 'auto' }}>
            {this.state.error.message}
          </pre>
          <pre style={{ whiteSpace: 'pre-wrap', background: '#f5f5f5', padding: '1rem', borderRadius: 8, fontSize: '0.7rem', overflow: 'auto', maxHeight: '50vh' }}>
            {this.state.error.stack}
          </pre>
          <button onClick={() => window.location.reload()} style={{ marginTop: '1rem', padding: '0.75rem 1.5rem', background: '#7C3AED', color: 'white', border: 'none', borderRadius: 8, fontSize: '1rem' }}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function ClientOnly({ children }: { children: React.ReactNode }) {
  return (
    <ErrorCatcher>
      <LayoutShell>{children}</LayoutShell>
    </ErrorCatcher>
  );
}
