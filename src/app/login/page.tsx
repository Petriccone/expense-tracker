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
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-purple-800 to-indigo-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/10 rounded-2xl mb-4">
            <Wallet className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">ExpenseAI</h1>
          <p className="text-purple-200 mt-2">Smart expense tracking</p>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-3xl shadow-2xl p-8">
          <h2 className="text-2xl font-bold text-slate-900 mb-6 text-center">
            {isLogin ? 'Welcome back!' : 'Create account'}
          </h2>

          {error && (
            <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl mb-4 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
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
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
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
              <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
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
              className="btn-primary w-full py-3 flex items-center justify-center gap-2"
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
              className="text-purple-600 hover:text-purple-700 font-medium"
            >
              {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
            </button>
          </div>
        </div>

        <p className="text-center text-purple-200 text-sm mt-6">
          Demo: Register a new account to get started
        </p>
      </div>
    </div>
  );
}
