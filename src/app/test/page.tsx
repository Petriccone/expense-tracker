'use client';

import { useState, useEffect, useRef } from 'react';

export default function TestPage() {
  const [count, setCount] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);

  const log = (msg: string) => {
    if (logRef.current) {
      const p = document.createElement('p');
      p.textContent = `${new Date().toLocaleTimeString()}: ${msg}`;
      p.style.margin = '2px 0';
      logRef.current.prepend(p);
    }
  };

  useEffect(() => {
    log('React useEffect fired - JS is running');

    // Test vanilla JS click
    const btn = document.getElementById('vanilla-btn');
    if (btn) {
      btn.addEventListener('click', () => log('Vanilla click worked!'));
      btn.addEventListener('touchstart', () => log('Vanilla touchstart worked!'));
    }
  }, []);

  return (
    <div style={{ padding: '1rem', fontFamily: 'sans-serif' }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Debug Test</h1>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
        <button
          id="vanilla-btn"
          style={{ padding: '1rem', background: '#10B981', color: 'white', border: 'none', borderRadius: 8, fontSize: '1rem' }}
        >
          1. Vanilla JS Button
        </button>

        <button
          onClick={() => { log('React onClick worked!'); setCount(c => c + 1); }}
          style={{ padding: '1rem', background: '#7C3AED', color: 'white', border: 'none', borderRadius: 8, fontSize: '1rem' }}
        >
          2. React Button (count: {count})
        </button>

        <button
          onTouchStart={() => log('React onTouchStart worked!')}
          onMouseDown={() => log('React onMouseDown worked!')}
          style={{ padding: '1rem', background: '#EF4444', color: 'white', border: 'none', borderRadius: 8, fontSize: '1rem' }}
        >
          3. Touch/Mouse Test
        </button>
      </div>

      <div
        ref={logRef}
        style={{ background: '#f1f5f9', padding: '0.5rem', borderRadius: 8, fontSize: '0.8rem', maxHeight: '50vh', overflow: 'auto' }}
      >
        <p style={{ margin: '2px 0', color: '#94a3b8' }}>Waiting for events...</p>
      </div>
    </div>
  );
}
