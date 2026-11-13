import { Fragment, useState, type FormEvent } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PASSWORD_MIN, type Member, type UserRole } from '@rajgruha/shared';
import { PageHeader } from '../../components/ui';
import { ApiError, api } from '../../lib/api';
import { generatePassword } from '../../lib/password';
import { meQuery, membersQuery } from '../../lib/queries';
import { showModal, showToast } from '../../ui/index.js';

export const Route = createFileRoute('/_app/members')({ component: Members });

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');

function Members() {
  const qc = useQueryClient();
  const { data: me } = useQuery(meQuery);
  const { data: members, isPending, error } = useQuery({ ...membersQuery, enabled: me?.role === 'admin' });
  const refresh = () => qc.invalidateQueries({ queryKey: ['members'] });

  const [form, setForm] = useState({ name: '', email: '', role: 'member' as UserRole, password: '' });
  const [created, setCreated] = useState<{ name: string; email: string; password: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [resetPw, setResetPw] = useState('');
  const [rowError, setRowError] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: () => api.createMember(form),
    onSuccess: (m) => { setCreated({ name: m.name, email: m.email, password: form.password }); setForm({ name: '', email: '', role: 'member', password: '' }); setFormError(null); void refresh(); },
    onError: (e) => setFormError(errMsg(e))
  });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { role?: UserRole; password?: string } }) => api.updateMember(id, patch),
    onSuccess: (_m, v) => { setRowError(null); if (v.patch.password) { showToast('Password reset — they’ve been signed out everywhere', { variant: 'success' }); setResetFor(null); setResetPw(''); } void refresh(); },
    onError: (e) => setRowError(errMsg(e))
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteMember(id),
    onSuccess: () => { showToast('Member removed', { variant: 'success' }); void refresh(); },
    onError: (e) => setRowError(errMsg(e))
  });

  if (me && me.role !== 'admin') return <div className="page-wrapper"><PageHeader title="Members" /><p style={{ color: 'var(--text-muted)' }}>Only administrators can manage members.</p></div>;

  const confirmRemove = (m: Member) =>
    showModal({
      title: `Remove ${m.name.replace(/[<&>]/g, '')}?`,
      size: 'sm',
      body: '<p style="font-size:13px;color:var(--text-secondary);line-height:1.6;margin:0">They’ll be signed out immediately, and their reading progress, sessions and notes are deleted. This can’t be undone.</p>',
      actions: [{ label: 'Cancel', variant: 'ghost' }, { label: 'Remove member', variant: 'danger', action: () => remove.mutate(m.id) }]
    });

  const submit = (e: FormEvent) => { e.preventDefault(); setCreated(null); add.mutate(); };

  return (
    <div className="page-wrapper">
      <PageHeader pretitle="Account" title="Members" />

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-header"><div><div className="card-title">Add a member</div><div className="card-subtitle">Share the password with them — they can change it in Your profile.</div></div></div>
        <form className="card-body" onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
          <div className="row col-2" style={{ gap: 14 }}>
            <div><label className="form-label" htmlFor="m-name">Name</label><input id="m-name" className="form-control" required maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><label className="form-label" htmlFor="m-email">Email</label><input id="m-email" className="form-control" type="email" required autoComplete="off" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div><label className="form-label" htmlFor="m-role">Role</label>
              <select id="m-role" className="form-control" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}><option value="member">Member — reads, requests books</option><option value="admin">Administrator — manages everything</option></select></div>
            <div><label className="form-label" htmlFor="m-pw">Password (min. {PASSWORD_MIN})</label>
              <div style={{ display: 'flex', gap: 8 }}><input id="m-pw" className="form-control" style={{ fontFamily: 'var(--font-mono, monospace)' }} required minLength={PASSWORD_MIN} autoComplete="off" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                <button type="button" className="btn btn-outline" onClick={() => setForm({ ...form, password: generatePassword() })}>Generate</button></div></div>
          </div>
          {formError && <div role="alert" className="notice err">{formError}</div>}
          {created && (
            <div role="status" className="notice ok">
              <strong>{created.name}</strong> was added. Give them this password now — it won’t be shown again:{' '}
              <code style={{ userSelect: 'all', fontWeight: 600 }}>{created.password}</code>{' '}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void navigator.clipboard?.writeText(`${created.email} / ${created.password}`)}>Copy email &amp; password</button>
            </div>
          )}
          <div><button className="btn btn-primary" type="submit" disabled={add.isPending || !form.name.trim() || form.password.length < PASSWORD_MIN}>{add.isPending ? 'Adding…' : 'Add member'}</button></div>
        </form>
      </div>

      <div className="card">
        <div className="card-header"><div><div className="card-title">All members</div><div className="card-subtitle">{members ? `${members.length} ${members.length === 1 ? 'person' : 'people'}` : '…'}</div></div></div>
        <div className="card-body p-0">
          {rowError && <div role="alert" className="notice err" style={{ margin: 12 }}>{rowError}</div>}
          {error && <p role="alert" style={{ padding: 16, color: 'var(--red)' }}>Could not load members.</p>}
          {isPending && <p style={{ padding: 16, color: 'var(--text-muted)' }}>Loading…</p>}
          <div className="table-scroll" style={{ maxHeight: 'none' }}>
            <table className="table" style={{ minWidth: 640 }}>
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {members?.map((m) => {
                  const self = m.id === me?.id;
                  return (
                    <Fragment key={m.id}>
                      <tr>
                        <td><span className="cell-trunc" title={m.name}>{m.name}{self && <span style={{ color: 'var(--text-muted)' }}> (you)</span>}</span></td>
                        <td><span className="cell-trunc wide" title={m.email}>{m.email}</span></td>
                        <td>
                          <select className="form-control" style={{ height: 30, width: 130 }} aria-label={`Role of ${m.name}`} value={m.role} disabled={self || update.isPending} title={self ? 'You can’t change your own role' : undefined}
                            onChange={(e) => update.mutate({ id: m.id, patch: { role: e.target.value as UserRole } })}>
                            <option value="member">Member</option><option value="admin">Administrator</option>
                          </select>
                        </td>
                        <td>{new Date(m.createdAt).toLocaleDateString()}</td>
                        <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => { setResetFor(resetFor === m.id ? null : m.id); setResetPw(''); }}>Reset password</button>
                          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} disabled={self} title={self ? 'You can’t remove yourself' : undefined} onClick={() => confirmRemove(m)}>Remove</button>
                        </td>
                      </tr>
                      {resetFor === m.id && (
                        <tr>
                          <td colSpan={5} style={{ background: 'var(--bg-surface-secondary)' }}>
                            <form style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }} onSubmit={(e) => { e.preventDefault(); update.mutate({ id: m.id, patch: { password: resetPw } }); }}>
                              <label htmlFor={`rp-${m.id}`} style={{ fontSize: 12.5 }}>New password for {m.name}</label>
                              <input id={`rp-${m.id}`} className="form-control" style={{ width: 240, height: 32, fontFamily: 'var(--font-mono, monospace)' }} minLength={PASSWORD_MIN} required autoComplete="off" value={resetPw} onChange={(e) => setResetPw(e.target.value)} />
                              <button type="button" className="btn btn-outline btn-sm" onClick={() => setResetPw(generatePassword())}>Generate</button>
                              <button className="btn btn-primary btn-sm" type="submit" disabled={resetPw.length < PASSWORD_MIN || update.isPending}>Set password</button>
                              <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>They’re signed out everywhere. Give them the new password yourself.</span>
                            </form>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
