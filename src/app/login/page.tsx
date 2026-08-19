'use client';

// Access-key login — one field, PT-BR, built for the couple's non-technical
// user. Replaces the old localStorage "demo" form (which never authenticated
// anything: the real gate used to be Traefik's basic-auth popup, a prompt the
// WhatsApp in-app browser never shows).
//
// Two ways in:
//   /login?key=<chave>  → auto-submits (magic link the agent sends).
//   /login              → the user types the chave once; the cookie lasts 90d.

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, LogIn, Wallet } from 'lucide-react';
import Logo from '@/components/Logo';

function LoginCard() {
  const router = useRouter();
  const params = useSearchParams();
  const [key, setKey] = useState(params.get('key') ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(params.get('erro') ? 'Chave inválida ou expirada.' : '');

  const submit = useCallback(
    async (value: string) => {
      if (!value.trim()) return;
      setLoading(true);
      setError('');
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: value.trim() }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setError(data.error || 'Chave inválida.');
          setLoading(false);
          return;
        }
        const next = params.get('next');
        const target =
          next && next.startsWith('/') && !next.startsWith('//') ? next : '/budget';
        router.push(target);
        router.refresh();
      } catch {
        setError('Não deu pra entrar agora. Tenta de novo.');
        setLoading(false);
      }
    },
    [params, router],
  );

  // Magic link: ?key= present → log in immediately, no typing.
  useEffect(() => {
    const k = params.get('key');
    if (k) void submit(k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{ background: 'var(--bg-deep)' }}
    >
      <div
        className="absolute inset-0 overflow-hidden pointer-events-none"
        aria-hidden="true"
      >
        <div
          className="animate-gradient"
          style={{
            position: 'absolute',
            top: '-20%',
            left: '-10%',
            width: '60%',
            height: '60%',
            borderRadius: '50%',
            background: 'radial-gradient(ellipse, rgba(124, 58, 237, 0.2), transparent 70%)',
            filter: 'blur(60px)',
          }}
        />
        <div
          className="animate-gradient"
          style={{
            position: 'absolute',
            bottom: '-20%',
            right: '-10%',
            width: '55%',
            height: '55%',
            borderRadius: '50%',
            background: 'radial-gradient(ellipse, rgba(6, 182, 212, 0.15), transparent 70%)',
            filter: 'blur(60px)',
            animationDelay: '4s',
          }}
        />
      </div>

      <div className="w-full max-w-md relative z-10 animate-fadeIn">
        <div className="text-center mb-8">
          <div
            className="inline-flex items-center justify-center rounded-2xl mb-5 animate-float"
            style={{
              width: 72,
              height: 72,
              background: 'linear-gradient(135deg, rgba(124, 58, 237, 0.2), rgba(6, 182, 212, 0.1))',
              border: '1px solid rgba(124, 58, 237, 0.2)',
              boxShadow: '0 0 30px rgba(124, 58, 237, 0.25), 0 0 60px rgba(6, 182, 212, 0.1)',
              backdropFilter: 'blur(12px)',
            }}
          >
            <Logo size={48} style={{ borderRadius: 12 }} />
          </div>
          <h1
            className="text-4xl font-bold mb-2"
            style={{
              background: 'linear-gradient(135deg, #7C3AED, #06B6D4)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            Nosso orçamento
          </h1>
          <p style={{ color: 'var(--text-secondary)' }} className="flex items-center justify-center gap-2">
            <Wallet className="w-4 h-4" /> Entra com a sua chave de acesso
          </p>
        </div>

        <div
          className="glass-card-static p-8"
          style={{ boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), 0 0 60px rgba(124, 58, 237, 0.08)' }}
        >
          {error && (
            <div
              className="px-4 py-3 rounded-xl mb-4 text-sm"
              style={{
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                color: '#f87171',
              }}
              role="alert"
            >
              {error}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit(key);
            }}
            className="space-y-4"
          >
            <div>
              <label
                className="block text-sm font-medium mb-1"
                style={{ color: 'var(--text-secondary)' }}
              >
                Chave de acesso
              </label>
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="cole aqui a chave que o assistente te mandou"
                className="input-field"
                autoFocus
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-3 flex items-center justify-center gap-2 animate-pulse-glow"
              style={{ marginTop: 8 }}
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <LogIn className="w-5 h-5" />
                  Entrar
                </>
              )}
            </button>
          </form>

          <p className="text-center text-sm mt-6" style={{ color: 'var(--text-muted)' }}>
            Só entra quem tem a chave — é o orçamento da família. 😉
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginCard />
    </Suspense>
  );
}
