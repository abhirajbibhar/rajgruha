import { useState, type FormEvent } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PASSWORD_MIN } from '@rajgruha/shared';
import { PageHeader } from '../../components/ui';
import { SettingsShell } from '../../components/SettingsShell';
import { ApiError, api } from '../../lib/api';
import { meQuery } from '../../lib/queries';
import { showModal, showToast } from '../../ui/index.js';

export const Route = createFileRoute('/_app/profile')({ component: Profile });

const msg = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');

function Profile() {
  const { data: me } = useQuery(meQuery);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState<string | null>(null);
  const [account, setAccount] = useState<{ busy?: boolean; error?: string }>({});
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwState, setPwState] = useState<{ busy?: boolean; error?: string }>({});

  if (!me) return <div className="page-wrapper" style={{ color: 'var(--text-muted)' }}>Loading…</div>;
  const shown = name ?? me.name;

  async function saveName(e: FormEvent) {
    e.preventDefault();
    setAccount({ busy: true });
    try {
      const user = await api.updateProfile(shown.trim());
      qc.setQueryData(['me'], user);
      setName(null);
      showToast('Profile updated', { variant: 'success' });
      setAccount({});
    } catch (err) { setAccount({ error: msg(err) }); }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    if (pw.next !== pw.confirm) return setPwState({ error: 'The new passwords don’t match.' });
    setPwState({ busy: true });
    try {
      await api.changePassword(pw.current, pw.next);
      setPw({ current: '', next: '', confirm: '' });
      setPwState({});
      showToast('Password changed — other devices were signed out', { variant: 'success' });
    } catch (err) { setPwState({ error: msg(err) }); }
  }

  const signOutEverywhere = () =>
    showModal({
      title: 'Sign out everywhere?',
      size: 'sm',
      body: '<p style="font-size:13px;color:var(--text-secondary);line-height:1.6;margin:0">This signs you out of every device, including this one. Use it if you think someone else has your session.</p>',
      actions: [
        { label: 'Cancel', variant: 'ghost' },
        { label: 'Sign out everywhere', variant: 'danger', action: () => void api.logoutEverywhere().then(() => { qc.clear(); return navigate({ to: '/login' }); }) }
      ]
    });

  return (
    <div className="page-wrapper">
      <PageHeader pretitle="Account" title="Your profile" />
      <SettingsShell
        sections={[
          {
            id: 'account', title: 'Account', desc: 'How you appear to other members.',
            children: (
              <form className="settings-form" onSubmit={saveName}>
                <div className="settings-row"><label htmlFor="p-name">Full name</label>
                  <input id="p-name" className="form-control" value={shown} maxLength={100} required onChange={(e) => setName(e.target.value)} /></div>
                <div className="settings-row"><label htmlFor="p-email">Email address</label>
                  <div className="settings-control"><input id="p-email" className="form-control" value={me.email} readOnly aria-describedby="p-email-hint" />
                    <div className="settings-hint" id="p-email-hint">You sign in with this address. An administrator can change it.</div></div></div>
                <div className="settings-row"><label>Role</label>
                  <div className="settings-control"><span className={me.role === 'admin' ? 'status status-green' : 'status status-blue'}>{me.role === 'admin' ? 'Administrator' : 'Member'}</span></div></div>
                {account.error && <div role="alert" className="notice err">{account.error}</div>}
                <div><button className="btn btn-primary" type="submit" disabled={account.busy || shown.trim() === me.name || !shown.trim()}>{account.busy ? 'Saving…' : 'Save changes'}</button></div>
              </form>
            )
          },
          {
            id: 'password', title: 'Password', desc: `At least ${PASSWORD_MIN} characters. Changing it signs you out of your other devices.`,
            children: (
              <form className="settings-form" onSubmit={savePassword}>
                <input type="text" name="username" autoComplete="username" value={me.email} readOnly hidden />
                <div className="settings-row"><label htmlFor="pw-cur">Current password</label>
                  <input id="pw-cur" className="form-control" type="password" autoComplete="current-password" required value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></div>
                <div className="settings-row"><label htmlFor="pw-new">New password</label>
                  <input id="pw-new" className="form-control" type="password" autoComplete="new-password" minLength={PASSWORD_MIN} required value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></div>
                <div className="settings-row"><label htmlFor="pw-conf">Confirm new password</label>
                  <input id="pw-conf" className="form-control" type="password" autoComplete="new-password" minLength={PASSWORD_MIN} required value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></div>
                {pwState.error && <div role="alert" className="notice err">{pwState.error}</div>}
                <div><button className="btn btn-primary" type="submit" disabled={pwState.busy || !pw.current || pw.next.length < PASSWORD_MIN}>{pwState.busy ? 'Changing…' : 'Change password'}</button></div>
              </form>
            )
          },
          {
            id: 'sessions', title: 'Sessions', danger: true, desc: 'Control where you’re signed in.',
            children: (
              <div className="settings-form">
                <div className="settings-row"><label>All devices</label>
                  <div className="settings-control"><button type="button" className="btn btn-outline" style={{ color: 'var(--red)' }} onClick={signOutEverywhere}>Sign out everywhere</button>
                    <div className="settings-hint">Ends every session, including this one.</div></div></div>
              </div>
            )
          }
        ]}
      />
    </div>
  );
}
