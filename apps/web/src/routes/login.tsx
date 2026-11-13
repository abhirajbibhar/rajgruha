import { useEffect, useState, type FormEvent } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '../lib/api';

export const Route = createFileRoute('/login')({ component: LoginPage });

function LoginPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Until hydration finishes the <form> would submit natively; keep the button off so credentials can never end up in the URL.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.login(String(form.get('email')), String(form.get('password')));
      qc.setQueryData(['me'], user);
      await navigate({ to: '/' });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in. Is the API running?');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-icon">R</div>
          <div className="brand-name">Rajgruha</div>
        </div>
        <div className="auth-title">Welcome back</div>
        <div className="auth-subtitle">Sign in to open your library.</div>

        <form method="post" onSubmit={onSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="email">Email</label>
            <input id="email" name="email" type="email" className="form-control" autoComplete="username" required autoFocus />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="password">Password</label>
            <input id="password" name="password" type="password" className="form-control" autoComplete="current-password" required />
          </div>
          {error && <div role="alert" style={{ color: 'var(--red)', fontSize: 12.5, marginBottom: 12 }}>{error}</div>}
          <button type="submit" className="btn btn-primary" disabled={busy || !ready} style={{ width: '100%', justifyContent: 'center', height: 38 }}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
