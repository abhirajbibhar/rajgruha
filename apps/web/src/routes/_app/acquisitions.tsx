import { useMemo, useState, type DragEvent, type FormEvent } from 'react';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AcquisitionStatus, type Acquisition } from '@rajgruha/shared';
import { PageHeader } from '../../components/ui';
import { ApiError, api } from '../../lib/api';
import { acquisitionsQuery, meQuery } from '../../lib/queries';
import { showModal, showToast } from '../../ui/index.js';

export const Route = createFileRoute('/_app/acquisitions')({ component: Acquisitions });

const COLUMNS: { status: AcquisitionStatus; title: string; color: string; hint: string }[] = [
  { status: 'requested', title: 'Requested', color: 'var(--text-muted)', hint: 'Waiting for review' },
  { status: 'evaluating', title: 'Evaluating', color: 'var(--blue)', hint: 'Checking price & availability' },
  { status: 'ordered', title: 'Ordered', color: 'var(--yellow)', hint: 'On its way' },
  { status: 'received', title: 'Received', color: 'var(--green)', hint: 'Ready to add to the catalog' },
  { status: 'declined', title: 'Declined', color: 'var(--red)', hint: 'Not going ahead' }
];
const PRIORITY_ICON = { high: '▲', normal: '', low: '▽' } as const;
type Draft = { title: string; author: string; isbn: string; notes: string; priority: 'low' | 'normal' | 'high' };
const EMPTY: Draft = { title: '', author: '', isbn: '', notes: '', priority: 'normal' };

/** Position for a card dropped at `index` in `column` (the dragged card already excluded). */
export const positionAt = (column: Pick<Acquisition, 'position'>[], index: number) => {
  const before = column[index - 1]?.position;
  const after = column[index]?.position;
  if (before === undefined && after === undefined) return 1;
  if (before === undefined) return after! - 1;
  if (after === undefined) return before + 1;
  return (before + after) / 2;
};

function Acquisitions() {
  const qc = useQueryClient();
  const { data: me } = useQuery(meQuery);
  const { data: cards, isPending, error } = useQuery(acquisitionsQuery);
  const admin = me?.role === 'admin';
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const byColumn = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const m = new Map<AcquisitionStatus, Acquisition[]>(COLUMNS.map((c) => [c.status, []]));
    for (const a of cards ?? []) if (!q || `${a.title} ${a.author ?? ''} ${a.isbn ?? ''}`.toLowerCase().includes(q)) m.get(a.status)!.push(a);
    for (const list of m.values()) list.sort((a, b) => a.position - b.position);
    return m;
  }, [cards, filter]);

  const save = useMutation({
    mutationFn: ({ id, draft }: { id: string | null; draft: Draft }) => {
      const body = { title: draft.title.trim(), author: draft.author.trim() || null, isbn: draft.isbn.trim() || null, notes: draft.notes.trim() || null, priority: draft.priority };
      return id ? api.updateAcquisition(id, body) : api.addAcquisition(body);
    },
    onSuccess: () => { setEditing(null); setFormError(null); void qc.invalidateQueries({ queryKey: ['acquisitions'] }); },
    onError: (e) => setFormError(e instanceof ApiError ? e.message : 'Could not save.')
  });

  // Moving is optimistic so the card never snaps back while the request is in flight.
  const move = useMutation({
    mutationFn: ({ id, status, position }: { id: string; status: AcquisitionStatus; position: number }) => api.updateAcquisition(id, { status, position }),
    onMutate: async ({ id, status, position }) => {
      await qc.cancelQueries({ queryKey: ['acquisitions'] });
      const previous = qc.getQueryData<Acquisition[]>(['acquisitions']);
      qc.setQueryData<Acquisition[]>(['acquisitions'], (cur) => cur?.map((a) => (a.id === id ? { ...a, status, position } : a)));
      return { previous };
    },
    onError: (_e, _v, ctx) => { qc.setQueryData(['acquisitions'], ctx?.previous); showToast('Could not move that request', { variant: 'error' }); },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['acquisitions'] })
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteAcquisition(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['acquisitions'] }),
    onError: () => showToast('Could not remove that request', { variant: 'error' })
  });

  const canEdit = (a: Acquisition) => admin || (a.requestedBy?.id === me?.id && a.status === 'requested');
  const confirmRemove = (a: Acquisition) =>
    showModal({
      title: 'Remove this request?', size: 'sm',
      body: `<p style="font-size:13px;color:var(--text-secondary);line-height:1.6;margin:0"><strong>${a.title.replace(/[<&>]/g, '')}</strong> will be deleted.</p>`,
      actions: [{ label: 'Cancel', variant: 'ghost' }, { label: 'Remove', variant: 'danger', action: () => remove.mutate(a.id) }]
    });

  // ── drag & drop (administrators) ──
  const drop = (status: AcquisitionStatus, beforeId: string | null) => (e: DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    setOver(null);
    const id = dragId; setDragId(null);
    if (!id) return;
    const list = (byColumn.get(status) ?? []).filter((a) => a.id !== id);
    const index = beforeId ? Math.max(0, list.findIndex((a) => a.id === beforeId)) : list.length;
    move.mutate({ id, status, position: positionAt(list, index) });
  };

  const submit = (e: FormEvent) => { e.preventDefault(); if (editing && editing.draft.title.trim()) save.mutate(editing); };
  const set = (k: keyof Draft, v: string) => setEditing((s) => s && { ...s, draft: { ...s.draft, [k]: v } });

  return (
    <div className="page-wrapper kanban-page">
      <PageHeader pretitle="Catalog" title="Acquisitions board"
        actions={<button className="btn btn-primary" onClick={() => { setFormError(null); setEditing({ id: null, draft: EMPTY }); }}>+ New request</button>} />

      {editing && (
        <form className="card" style={{ marginBottom: 16 }} onSubmit={submit}>
          <div className="card-header"><div className="card-title">{editing.id ? 'Edit request' : 'Request a book'}</div></div>
          <div className="card-body" style={{ display: 'grid', gap: 12 }}>
            <div className="row col-2" style={{ gap: 12 }}>
              <div><label className="form-label" htmlFor="a-title">Title *</label><input id="a-title" className="form-control" required autoFocus maxLength={200} value={editing.draft.title} onChange={(e) => set('title', e.target.value)} /></div>
              <div><label className="form-label" htmlFor="a-author">Author</label><input id="a-author" className="form-control" maxLength={200} value={editing.draft.author} onChange={(e) => set('author', e.target.value)} /></div>
              <div><label className="form-label" htmlFor="a-isbn">ISBN</label><input id="a-isbn" className="form-control" maxLength={20} value={editing.draft.isbn} onChange={(e) => set('isbn', e.target.value)} /></div>
              <div><label className="form-label" htmlFor="a-pri">Priority</label>
                <select id="a-pri" className="form-control" value={editing.draft.priority} onChange={(e) => set('priority', e.target.value)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></div>
            </div>
            <div><label className="form-label" htmlFor="a-notes">Notes</label><textarea id="a-notes" className="form-control" rows={2} maxLength={1000} placeholder="Why is it wanted? Edition, price, where to find it…" value={editing.draft.notes} onChange={(e) => set('notes', e.target.value)} /></div>
            {formError && <div role="alert" className="notice err">{formError}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" type="submit" disabled={save.isPending || !editing.draft.title.trim()}>{save.isPending ? 'Saving…' : editing.id ? 'Save' : 'Submit request'}</button>
              <button className="btn btn-ghost" type="button" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        </form>
      )}

      <div style={{ marginBottom: 14 }}>
        <div className="inline-search"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="7" cy="7" r="5" /><path d="M11 11l3.5 3.5" /></svg>
          <input type="search" placeholder="Filter requests…" aria-label="Filter requests" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
      </div>
      {error && <p role="alert" style={{ color: 'var(--red)' }}>Could not load the board.</p>}
      {isPending && <p style={{ color: 'var(--text-muted)' }}>Loading…</p>}

      <div className="kanban-board five">
        {COLUMNS.map((col) => {
          const list = byColumn.get(col.status) ?? [];
          return (
            <section key={col.status} className="kanban-column" aria-label={col.title}>
              <header className="kanban-column-head">
                <span className="dot" style={{ background: col.color }} /><span className="title">{col.title}</span><span className="count">{list.length}</span>
              </header>
              <div className={over === col.status ? 'kanban-column-body drop-target' : 'kanban-column-body'}
                onDragOver={admin ? (e) => { e.preventDefault(); setOver(col.status); } : undefined}
                onDragLeave={admin ? () => setOver((o) => (o === col.status ? null : o)) : undefined}
                onDrop={admin ? drop(col.status, null) : undefined}>
                {list.map((a) => (
                  <article key={a.id} className={dragId === a.id ? 'kanban-card dragging' : 'kanban-card'} draggable={admin} data-id={a.id}
                    onDragStart={admin ? (e) => { setDragId(a.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', a.id); } : undefined}
                    onDragEnd={() => { setDragId(null); setOver(null); }}
                    onDragOver={admin ? (e) => { e.preventDefault(); } : undefined}
                    onDrop={admin ? drop(col.status, a.id) : undefined}>
                    <div className="kanban-card-title">{PRIORITY_ICON[a.priority] && <span title={`${a.priority} priority`} style={{ color: a.priority === 'high' ? 'var(--red)' : 'var(--text-muted)', marginInlineEnd: 6 }}>{PRIORITY_ICON[a.priority]}</span>}{a.title}</div>
                    {(a.author || a.isbn) && <div className="kanban-card-desc">{[a.author, a.isbn && `ISBN ${a.isbn}`].filter(Boolean).join(' · ')}</div>}
                    {a.notes && <div className="kanban-card-desc" style={{ fontStyle: 'italic' }}>{a.notes}</div>}
                    <div className="kanban-card-foot">
                      <div className="kanban-card-meta"><span className="due-date">{a.requestedBy?.name ?? 'Removed member'} · {new Date(a.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span></div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
                      {admin && (
                        <select className="form-control" style={{ height: 28, fontSize: 12, width: 'auto', maxWidth: 130 }} aria-label={`Move “${a.title}” to`} value={a.status}
                          onChange={(e) => { const s = e.target.value as AcquisitionStatus; move.mutate({ id: a.id, status: s, position: positionAt(byColumn.get(s) ?? [], (byColumn.get(s) ?? []).length) }); }}>
                          {COLUMNS.map((c) => <option key={c.status} value={c.status}>{c.title}</option>)}
                        </select>
                      )}
                      {canEdit(a) && <button className="btn btn-ghost btn-sm" onClick={() => { setFormError(null); setEditing({ id: a.id, draft: { title: a.title, author: a.author ?? '', isbn: a.isbn ?? '', notes: a.notes ?? '', priority: a.priority } }); }}>Edit</button>}
                      {canEdit(a) && <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={() => confirmRemove(a)}>{admin ? 'Remove' : 'Withdraw'}</button>}
                      {admin && a.status === 'received' && (
                        <Link className="btn btn-outline btn-sm" to="/upload" search={{ tab: 'scan', title: a.title, author: a.author ?? undefined, isbn: a.isbn ?? undefined }}>Add to catalog</Link>
                      )}
                    </div>
                  </article>
                ))}
                {list.length === 0 && <div style={{ padding: '14px 8px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>{col.hint}</div>}
              </div>
            </section>
          );
        })}
      </div>
      {!admin && <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12 }}>An administrator moves requests along. You can edit or withdraw your own request until it’s moved.</p>}
    </div>
  );
}
