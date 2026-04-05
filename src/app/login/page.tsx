'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogIn, UserPlus, Loader2, Wallet } from 'lucide-react';
import bcrypt from 'bcryptjs';

export default function LoginPage() {
  const router = useRouter();
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    email: '',
    password: '',
    name: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Simulate a small delay
    await new Promise((resolve) => setTimeout(resolve, 300));

    try {
      if (isLogin) {
        // Client-side login: check stored users
        const storedUsers = JSON.parse(localStorage.getItem('expense-tracker-users') || '[]');
        const user = storedUsers.find((u: { email: string }) => u.email === form.email);

        if (!user) {
          setError('E-mail ou senha inválidos');
          return;
        }

        // Support both hashed and legacy plain-text passwords
        const isMatch = user.password.startsWith('$2')
          ? await bcrypt.compare(form.password, user.password)
          : user.password === form.password;

        if (!isMatch) {
          setError('E-mail ou senha inválidos');
          return;
        }

        localStorage.setItem('auth_token', 'local_' + Date.now());
        localStorage.setItem('user', JSON.stringify({ id: user.id, email: user.email, name: user.name }));
      } else {
        // Client-side register: store in localStorage
        const storedUsers = JSON.parse(localStorage.getItem('expense-tracker-users') || '[]');

        if (storedUsers.find((u: { email: string }) => u.email === form.email)) {
          setError('E-mail já cadastrado');
          return;
        }

        const hashedPassword = await bcrypt.hash(form.password, 10);
        const newUser = {
          id: Date.now().toString(),
          email: form.email,
          password: hashedPassword,
          name: form.name || form.email.split('@')[0],
        };

        storedUsers.push(newUser);
        localStorage.setItem('expense-tracker-users', JSON.stringify(storedUsers));
        localStorage.setItem('auth_token', 'local_' + Date.now());
        localStorage.setItem('user', JSON.stringify({ id: newUser.id, email: newUser.email, name: newUser.name }));
      }

      router.push('/');
    } catch (err) {
      setError('Algo deu errado');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{ background: 'var(--bg-deep)' }}
    >
      {/* Animated gradient orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="animate-gradient"
          style={{
            position: 'absolute',
            top: '-20%', left: '-10%',
            width: '60%', height: '60%',
            borderRadius: '50%',
            background: 'radial-gradient(ellipse, rgba(124, 58, 237, 0.2), transparent 70%)',
            filter: 'blur(60px)',
          }}
        />
        <div
          className="animate-gradient"
          style={{
            position: 'absolute',
            bottom: '-20%', right: '-10%',
            width: '55%', height: '55%',
            borderRadius: '50%',
            background: 'radial-gradient(ellipse, rgba(6, 182, 212, 0.15), transparent 70%)',
            filter: 'blur(60px)',
            animationDelay: '4s',
          }}
        />
        <div
          className="animate-gradient"
          style={{
            position: 'absolute',
            top: '40%', left: '50%',
            width: '40%', height: '40%',
            borderRadius: '50%',
            background: 'radial-gradient(ellipse, rgba(124, 58, 237, 0.08), transparent 70%)',
            filter: 'blur(80px)',
            animationDelay: '2s',
          }}
        />
      </div>

      <div className="w-full max-w-md relative z-10 animate-fadeIn">
        {/* Logo */}
        <div className="text-center mb-8">
          <div
            className="inline-flex items-center justify-center w-18 h-18 rounded-2xl mb-5 animate-float"
            style={{
              width: 72, height: 72,
              background: 'linear-gradient(135deg, rgba(124, 58, 237, 0.2), rgba(6, 182, 212, 0.1))',
              border: '1px solid rgba(124, 58, 237, 0.2)',
              boxShadow: '0 0 30px rgba(124, 58, 237, 0.25), 0 0 60px rgba(6, 182, 212, 0.1)',
              backdropFilter: 'blur(12px)',
            }}
          >
            <img src="/expense-tracker/icon.svg" alt="ExpensesAI" style={{ width: 48, height: 48, borderRadius: 12 }} />
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
            ExpensesAI
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>Controle inteligente de despesas</p>
        </div>

        {/* Login Card */}
        <div
          className="glass-card-static p-8"
          style={{
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), 0 0 60px rgba(124, 58, 237, 0.08)',
          }}
        >
          <h2 className="text-2xl font-bold mb-6 text-center" style={{ color: 'var(--text-primary)' }}>
            {isLogin ? 'Bem-vindo de volta!' : 'Criar conta'}
          </h2>

          {error && (
            <div
              className="px-4 py-3 rounded-xl mb-4 text-sm"
              style={{
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                color: '#f87171',
              }}
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Nome</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Seu nome"
                  className="input-field"
                  required={!isLogin}
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>E-mail</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="voce@exemplo.com"
                className="input-field"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Senha</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="••••••••"
                className="input-field"
                required
                minLength={6}
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
              ) : isLogin ? (
                <>
                  <LogIn className="w-5 h-5" />
                  Entrar
                </>
              ) : (
                <>
                  <UserPlus className="w-5 h-5" />
                  Criar Conta
                </>
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={() => {
                setIsLogin(!isLogin);
                setError('');
              }}
              className="font-medium transition-colors"
              style={{
                color: '#a78bfa',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              {isLogin ? 'Não tem uma conta? Cadastre-se' : 'Já tem uma conta? Entre'}
            </button>
          </div>
        </div>

        <p className="text-center text-sm mt-6" style={{ color: 'var(--text-muted)' }}>
          Demo: Cadastre uma nova conta para começar
        </p>
      </div>
    </div>
  );
}
