/**
 * Sign in, and the first-run flow that creates the owner account.
 *
 * On a brand new instance registration is open, so the first person to sign up
 * becomes the owner and the instance closes behind them. That means a fresh
 * deployment is never left with an open sign-up page.
 */
import { useState } from 'react';
import { api } from '../api';
import { Banner, Field, Spinner, useToast } from '../components/ui';
import { LibraryMark } from '../components/Icons';
import type { SessionUser } from '../../../shared/types';

interface Props {
  appName: string;
  registrationOpen: boolean;
  initialized: boolean;
  onSignedIn: (user: SessionUser) => void;
}

export default function Login({ appName, registrationOpen, initialized, onSignedIn }: Props) {
  const toast = useToast();
  const [mode, setMode] = useState<'signin' | 'create'>(initialized ? 'signin' : 'create');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const creating = mode === 'create';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (creating && password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      const result = creating
        ? await api.register(email.trim(), name.trim(), password)
        : await api.login(email.trim(), password);
      onSignedIn(result.user);
    } catch (thrown) {
      const message = thrown instanceof Error ? thrown.message : 'Could not sign in.';
      setError(message);
      toast.error(thrown);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth__panel">
        <LibraryMark className="auth__mark" />
        <div>
          <h1>{appName}</h1>
          <p className="muted small" style={{ margin: 0 }}>
            {creating
              ? initialized
                ? 'Create another account on this instance.'
                : 'Create the owner account for this library.'
              : 'Your library, notes and quotes — private to you.'}
          </p>
        </div>

        {error && <Banner kind="error">{error}</Banner>}

        <form className="stack" onSubmit={submit}>
          {creating && (
            <Field label="Your name">
              <input
                className="input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                required
                maxLength={80}
              />
            </Field>
          )}

          <Field label="Email">
            <input
              className="input"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              inputMode="email"
              required
              maxLength={254}
            />
          </Field>

          <Field label="Password" hint={creating ? 'at least 10 characters' : undefined}>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={creating ? 'new-password' : 'current-password'}
              required
              minLength={creating ? 10 : undefined}
              maxLength={200}
            />
          </Field>

          {creating && (
            <Field label="Repeat password">
              <input
                className="input"
                type="password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                autoComplete="new-password"
                required
              />
            </Field>
          )}

          <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
            {busy ? <Spinner /> : null}
            {creating ? 'Create account' : 'Sign in'}
          </button>
        </form>

        {registrationOpen && initialized && (
          <button
            type="button"
            className="btn btn--ghost btn--block"
            onClick={() => {
              setMode(creating ? 'signin' : 'create');
              setError(null);
            }}
          >
            {creating ? 'I already have an account' : 'Create another account'}
          </button>
        )}

        {!initialized && (
          <p className="tiny faint" style={{ margin: 0 }}>
            This is a fresh instance. The first account created becomes the owner and closes
            sign-ups.
          </p>
        )}
      </div>
    </div>
  );
}
