import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Icon } from '../../components/icons';
import { PageHeader } from '../../components/ui';
import { showModal, showToast } from '../../ui/index.js';
import { api } from '../../lib/api';
import { fmtBytes } from '../../lib/dates';
import { filesQuery, meQuery } from '../../lib/queries';

export const Route = createFileRoute('/_app/files')({
  validateSearch: z.object({ prefix: z.string().optional() }),
  component: BookFiles
});

/** Browse the R2 folder structure that uploads create. Folders on top, files below. */
function BookFiles() {
  const { prefix = '' } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const qc = useQueryClient();
  const { data: me } = useQuery(meQuery);
  const { data, isPending, error } = useQuery(filesQuery(prefix));
  const admin = me?.role === 'admin';
  const open = (p: string) => void navigate({ search: p ? { prefix: p } : {} });

  const del = useMutation({
    mutationFn: ({ key, withBook }: { key: string; withBook: boolean }) => api.deleteFile(key, withBook),
    onSuccess: () => { showToast('File deleted', { variant: 'success' }); for (const k of ['files', 'books', 'stats']) void qc.invalidateQueries({ queryKey: [k] }); },
    onError: () => showToast('Could not delete the file', { variant: 'error' })
  });

  const confirmDelete = (key: string, name: string, linked: boolean) =>
    showModal({
      title: 'Delete this file?',
      size: 'sm',
      body: `<p style="font-size:13px;color:var(--text-secondary);line-height:1.6;margin:0"><strong>${name.replace(/[<&>]/g, '')}</strong> will be removed from storage.${linked ? ' The book entry stays in the catalog (without a file) unless you choose “Delete book too”.' : ''}</p>`,
      actions: [
        { label: 'Cancel', variant: 'ghost' as const },
        ...(linked ? [{ label: 'Delete book too', variant: 'ghost' as const, action: () => del.mutate({ key, withBook: true }) }] : []),
        { label: 'Delete file', variant: 'danger' as const, action: () => del.mutate({ key, withBook: false }) }
      ]
    });

  const parts = prefix.split('/').filter(Boolean);
  const notConfigured = error && /not configured|501/i.test(String(error.message));

  return (
    <div className="page-wrapper">
      <PageHeader
        pretitle="Catalog · Storage"
        title="Book files"
        actions={admin ? <Link className="btn btn-primary" to="/upload" search={{ folder: prefix || undefined }}><Icon name="files" size={14} /> Upload here</Link> : undefined}
      />

      <div className="card">
        <div className="card-header" style={{ flexWrap: 'wrap', gap: 6 }}>
          <nav className="breadcrumb" aria-label="Folder path" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => open('')} aria-current={parts.length === 0 ? 'page' : undefined}>Library</button>
            {parts.map((p, i) => (
              <span key={i} style={{ display: 'contents' }}>
                <span className="sep" aria-hidden="true">›</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => open(parts.slice(0, i + 1).join('/'))} aria-current={i === parts.length - 1 ? 'page' : undefined}>{p}</button>
              </span>
            ))}
          </nav>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{data ? `${data.folders.length} folders · ${data.files.length} files` : ''}</span>
        </div>

        <div className="card-body p-0">
          {isPending && <p style={{ padding: 16, color: 'var(--text-muted)' }}>Loading…</p>}
          {notConfigured && <p style={{ padding: 16, color: 'var(--text-muted)' }}>File storage (R2) isn’t configured for this environment.</p>}
          {error && !notConfigured && <p role="alert" style={{ padding: 16, color: 'var(--red)' }}>Could not load files.</p>}

          {prefix && (
            <button type="button" className="fb-row" style={{ width: '100%', background: 'none', border: 0, textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'pointer' }} onClick={() => open(parts.slice(0, -1).join('/'))}>
              <span className="ic" aria-hidden="true">↰</span><span className="nm"><strong>..</strong><span>Up one level</span></span>
            </button>
          )}
          {data?.folders.map((f) => (
            <button key={f.prefix} type="button" className="fb-row" style={{ width: '100%', background: 'none', border: 0, textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'pointer' }} onClick={() => open(f.prefix)}>
              <span className="ic" aria-hidden="true"><Icon name="projects" size={18} /></span>
              <span className="nm"><strong title={f.name}>{f.name}</strong><span>Folder</span></span>
              <span aria-hidden="true" style={{ color: 'var(--text-muted)' }}>›</span>
            </button>
          ))}
          {data?.files.map((f) => (
            <div key={f.key} className="fb-row">
              <span className="ic" aria-hidden="true"><Icon name="book" size={18} /></span>
              <div className="nm">
                <strong title={f.name}>{f.book ? f.book.title : f.name}</strong>
                <span>{f.book ? `${f.name} · ` : 'Not linked to a book · '}{fmtBytes(f.size)} · {new Date(f.uploaded).toLocaleDateString()}</span>
              </div>
              <div className="acts">
                {f.book && f.book.format !== 'audio' && <Link className="btn btn-outline btn-sm" to="/read/$bookId" params={{ bookId: f.book.slug }} aria-label={`Read ${f.book.title}`}>Read</Link>}
                {f.book && <Link className="btn btn-ghost btn-sm" to="/books/$bookId" params={{ bookId: f.book.slug }}>Details</Link>}
                <a className="btn btn-ghost btn-sm" href={api.rawFileUrl(f.key, true)} aria-label={`Download ${f.name}`}>↓<span> Download</span></a>
                {admin && <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} aria-label={`Delete ${f.name}`} onClick={() => confirmDelete(f.key, f.name, !!f.book)}>✕<span> Delete</span></button>}
              </div>
            </div>
          ))}
          {data && data.folders.length === 0 && data.files.length === 0 && (
            <p style={{ padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>This folder is empty.{admin && <> <Link to="/upload" search={{ folder: prefix || undefined }}>Upload books</Link> to fill it.</>}</p>
          )}
        </div>
      </div>
    </div>
  );
}
