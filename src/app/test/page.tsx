'use client';

import { useState } from 'react';

export default function TestPage() {
  const [count, setCount] = useState(0);

  return (
    <div style={{ padding: '2rem' }}>
      <h1>Test Page - Interactivity Check</h1>
      <p>Count: {count}</p>
      <button
        onClick={() => setCount(count + 1)}
        style={{
          padding: '1rem 2rem',
          background: '#7C3AED',
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          cursor: 'pointer',
          fontSize: '1.2rem',
        }}
      >
        Click me
      </button>
      <p style={{ marginTop: '1rem', color: '#666' }}>
        If you can click the button and the count increases, React hydration is working.
      </p>
    </div>
  );
}
