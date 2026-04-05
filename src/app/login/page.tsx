'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogIn, UserPlus, Loader2, Wallet } from 'lucide-react';

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

        if (!user || user.password !== form.password) {
          setError('Invalid email or password');
          return;
        }

        localStorage.setItem('auth_token', 'local_' + Date.now());
        localStorage.setItem('user', JSON.stringify({ id: user.id, email: user.email, name: user.name }));
      } else {
        // Client-side register: store in localStorage
        const storedUsers = JSON.parse(localStorage.getItem('expense-tracker-users') || '[]');

        if (storedUsers.find((u: { email: string }) => u.email === form.email)) {
          setError('Email already registered');
          return;
        }

        const newUser = {
          id: Date.now().toString(),
          email: form.email,
          password: form.password,
          name: form.name || form.email.split('@')[0],
        };

        storedUsers.push(newUser);
        localStorage.setItem('expense-tracker-users', JSON.stringify(storedUsers));
        localStorage.setItem('auth_token', 'local_' + Date.now());
        localStorage.setItem('user', JSON.stringify({ id: newUser.id, email: newUser.email, name: newUser.name }));
      }

      router.push('/');
    } catch (err) {
      setError('Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{ background: '#050a18' }}
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
            <img src="/expense-tracker/icon.svg" alt="ExpenseAI" style={{ width: 48, height: 48, borderRadius: 12 }} />
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
            ExpenseAI
          </h1>
          <p style={{ color: '#8892a8' }}>Smart expense tracking, powered by intelligence</p>
        </div>

        {/* Login Card */}
        <div
          className="glass-card-static p-8"
          style={{
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), 0 0 60px rgba(124, 58, 237, 0.08)',
          }}
        >
          <h2 className="text-2xl font-bold mb-6 text-center" style={{ color: '#e8edf5' }}>
            {isLogin ? 'Welcome back!' : 'Create account'}
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
                <label className="block text-sm font-medium mb-1" style={{ color: '#8892a8' }}>Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Your name"
                  className="input-field"
                  required={!isLogin}
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: '#8892a8' }}>Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="you@example.com"
                className="input-field"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: '#8892a8' }}>Password</label>
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
                  Sign In
                </>
              ) : (
                <>
                  <UserPlus className="w-5 h-5" />
                  Create Account
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
              {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
            </button>
          </div>
        </div>

        <p className="text-center text-sm mt-6" style={{ color: '#5a6478' }}>
          Demo: Register a new account to get started
        </p>
      </div>
    </div>
  );
}
