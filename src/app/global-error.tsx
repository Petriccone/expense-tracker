'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body style={{ padding: '2rem', fontFamily: 'monospace' }}>
        <h1 style={{ color: 'red' }}>Something went wrong!</h1>
        <pre style={{ whiteSpace: 'pre-wrap', background: '#f5f5f5', padding: '1rem', borderRadius: '8px' }}>
          {error.message}
        </pre>
        <pre style={{ whiteSpace: 'pre-wrap', background: '#fff0f0', padding: '1rem', borderRadius: '8px', fontSize: '12px' }}>
          {error.stack}
        </pre>
        <button
          onClick={() => reset()}
          style={{ marginTop: '1rem', padding: '0.5rem 1rem', background: '#7C3AED', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
