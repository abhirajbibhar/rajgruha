import { useEffect, useState, type FormEvent } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ApiError, api } from '../lib/api';
import { meQuery } from '../lib/queries';
import { LOCK_KEY } from '../components/AppShell';

export const Route = createFileRoute('/lock')({ ssr: false, component: LockScreen });

function LockScreen() {
  const navigate = useNavigate();
  const { data: user, error } = useQuery(meQuery);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  if (error instanceof ApiError && error.status === 401) void navigate({ to: '/login' });

  async function unlock(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.login(user.email, String(new FormData(e.currentTarget).get('password')));
      const back = sessionStorage.getItem(LOCK_KEY) || '/';
      sessionStorage.removeItem(LOCK_KEY);
      window.location.assign(back); // full navigation: fresh session + clean state
    } catch (err) {
      setMsg(err instanceof ApiError ? 'Incorrect password' : 'Could not reach the API');
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card lock-screen">
        <div className="lock-avatar" aria-hidden="true">
          <div className="lock-avatar-circle" style={{ background: 'linear-gradient(135deg,var(--primary),var(--primary-dk))' }}>{user?.name.charAt(0).toUpperCase() ?? '·'}</div>
          <div className="lock-icon">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="7" width="10" height="7" rx="1.5" /><path d="M5 7V5a3 3 0 016 0v2" /></svg>
          </div>
        </div>
        <div className="auth-title" style={{ textAlign: 'center', marginTop: 14 }}>Welcome back{user ? `, ${user.name.split(' ')[0]}` : ''}</div>
        <div className="auth-subtitle" style={{ textAlign: 'center' }}>Your session is locked. Enter your password to continue.</div>
        <form method="post" onSubmit={unlock}>
          <div className="form-group">
            <label className="form-label" htmlFor="password">Password</label>
            <input id="password" name="password" type="password" className="form-control" autoComplete="current-password" required autoFocus />
          </div>
          {msg && <div role="alert" style={{ color: 'var(--red)', fontSize: 12.5, marginBottom: 12 }}>{msg}</div>}
          <button type="submit" className="btn btn-primary" disabled={busy || !user || !ready} style={{ width: '100%', justifyContent: 'center', height: 38 }}>{busy ? 'Unlocking…' : 'Unlock'}</button>
        </form>
      </div>
    </div>
  );
}
