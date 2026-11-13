import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import type { Book, BookPatch } from '@rajgruha/shared';
import { OutlineEditor, withIds, type Row } from '../../components/OutlineEditor';
import { PageHeader } from '../../components/ui';
import { showToast } from '../../ui/index.js';
import { ApiError, api } from '../../lib/api';
import { normalizeIsbn } from '../../lib/bookmeta';
import { PdfEditError, readPdf, writePdf, type PdfInfo, type PdfRead } from '../../lib/pdf/engine';
import { outlineToToc } from '../../lib/pdf/outlineOps';
import { bookQuery, meQuery } from '../../lib/queries';

export const Route = createFileRoute('/_app/edit/$bookId')({
  validateSearch: z.object({ tab: z.enum(['details', 'chapters']).optional() }),
  component: EditPage
});

type Form = { title: string; author: string; description: string; genres: string; publisher: string; year: string; isbn: string; language: string; series: string };
const fromBook = (b: Book): Form => ({ title: b.title, author: b.author === 'Unknown' ? '' : b.author, description: b.description ?? '', genres: b.genres.join(', '), publisher: b.publisher ?? '', year: b.publishedYear ? String(b.publishedYear) : '', isbn: b.isbn ?? '', language: b.language, series: b.series ?? '' });
const fromInfo = (i: PdfInfo, b: Book): Form => ({ title: i.title || b.title, author: i.author || (b.author === 'Unknown' ? '' : b.author), description: i.description, genres: i.genres.join(', '), publisher: i.publisher, year: i.year ? String(i.year) : '', isbn: i.isbn, language: i.language || b.language, series: i.series });
const toInfo = (f: Form): PdfInfo => ({
  title: f.title.trim(), author: f.author.trim(), description: f.description.trim(), genres: f.genres.split(/[;,]/).map((s) => s.trim()).filter(Boolean),
  publisher: f.publisher.trim(), year: /^\d{4}$/.test(f.year.trim()) ? Number(f.year) : null, isbn: f.isbn.trim(), language: f.language.trim(), series: f.series.trim()
});

/** What the catalog index (D1) keeps for search/listing — always derived from the file for PDFs. */
const indexPatch = (info: PdfInfo, read: Pick<PdfRead, 'outline' | 'pageCount'>, fallbackTitle: string): BookPatch => ({
  title: info.title || fallbackTitle, author: info.author || 'Unknown', description: info.description || null, publisher: info.publisher || null,
  publishedYear: info.year, pages: read.pageCount, language: info.language || 'en', isbn: info.isbn || null, genres: info.genres, series: info.series || null,
  toc: outlineToToc(read.outline)
});

function EditPage() {
  const { bookId } = Route.useParams();
  const { data: me } = useQuery(meQuery);
  const { data: book, isPending } = useQuery(bookQuery(bookId));
  if (me && me.role !== 'admin') return <div className="page-wrapper"><PageHeader title="Edit book" /><p style={{ color: 'var(--text-muted)' }}>Only administrators can edit books.</p></div>;
  if (isPending || !book) return <div className="page-wrapper" style={{ color: 'var(--text-muted)' }}>Loading…</div>;
  return <Editor key={`${book.id}:${book.fileKey ?? ''}`} book={book} />;
}

type Loaded = { buffer: ArrayBuffer; etag: string; read: PdfRead };

function Editor({ book }: { book: Book }) {
  const { tab = 'details' } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const qc = useQueryClient();
  const isPdf = book.format === 'pdf' && !!book.fileKey;

  const [form, setForm] = useState<Form>(() => fromBook(book));
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [initial, setInitial] = useState('');
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>(isPdf ? 'loading' : 'ready');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingSync, setPendingSync] = useState<PdfInfo | null>(null);
  const [addedInfo, setAddedInfo] = useState(false);

  const snapshot = (f: Form, r: Row[]) => JSON.stringify([f, r.map(({ title, page, level }) => [title, page, level])]);

  // Load the PDF itself — it, not the catalog, is the source of truth for what the form shows.
  const load = useCallback(async () => {
    setPhase('loading'); setError(null);
    try {
      const { buffer, etag } = await api.downloadFile(book.id);
      const read = await readPdf(buffer.slice(0));
      const f = fromInfo(read.info, book);
      const r = withIds(read.outline);
      setLoaded({ buffer, etag, read }); setForm(f); setRows(r); setInitial(snapshot(f, r)); setPhase('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the PDF'); setPhase('error');
    }
  }, [book]);

  useEffect(() => { if (isPdf) void load(); else setInitial(snapshot(form, rows)); }, []);

  const dirty = initial !== '' && snapshot(form, rows) !== initial;
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const info = toInfo(form);
  const problems = useMemo(() => {
    const p: string[] = [];
    if (!info.title) p.push('A title is required.');
    if (form.year.trim() && info.year === null) p.push('Year must be four digits (e.g. 2021).');
    return p;
  }, [info.title, info.year, form.year]);
  const isbnWarning = info.isbn && !normalizeIsbn(info.isbn) ? 'This doesn’t look like a valid ISBN — it will be saved as typed.' : null;

  const done = async (msg: string) => {
    for (const k of ['book', 'books', 'continue', 'stats']) await qc.invalidateQueries({ queryKey: [k] });
    showToast(msg, { variant: 'success' });
    await navigate({ to: '/books/$bookId', params: { bookId: book.slug }, search: undefined });
  };

  async function save() {
    if (problems.length) return;
    setError(null); setPendingSync(null);
    try {
      if (!isPdf || !loaded) {
        setBusy('Saving…');
        await api.patchBook(book.id, { title: info.title, author: info.author || 'Unknown', description: info.description || null, publisher: info.publisher || null, publishedYear: info.year, language: info.language || 'en', isbn: info.isbn || null, genres: info.genres, series: info.series || null });
        return await done('Saved');
      }
      setBusy('Writing the PDF…');
      const { bytes, readBack, addedInfoDict } = await writePdf(loaded.buffer, { info, outline: rows });
      setAddedInfo(addedInfoDict);
      setBusy('Uploading the file…');
      const res = await api.replaceFile(book.id, bytes, 'application/pdf', loaded.etag);
      setLoaded({ buffer: bytes, etag: res.etag, read: readBack });
      setBusy('Updating the catalog…');
      try {
        await api.patchBook(book.id, indexPatch(readBack.info, readBack, book.title));
      } catch {
        setPendingSync(readBack.info); // the FILE is saved; only the search index is behind
        setError('The PDF was saved, but the catalog index could not be updated. Retry the sync below.');
        return;
      }
      await done('PDF saved — metadata and chapters are now inside the file');
    } catch (e) {
      setError(e instanceof PdfEditError ? e.message : e instanceof ApiError && e.status === 412 ? 'Somebody else changed this file while you were editing. Reload the page to get their version, then redo your edit.' : e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(null);
    }
  }

  async function retrySync() {
    if (!loaded) return;
    setBusy('Updating the catalog…'); setError(null);
    try { await api.patchBook(book.id, indexPatch(loaded.read.info, loaded.read, book.title)); setPendingSync(null); await done('Catalog updated'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Sync failed again'); }
    finally { setBusy(null); }
  }

  /** Re-mirror the catalog from the file as it is stored (no edit). */
  async function syncFromFile() {
    if (!loaded) return;
    setBusy('Updating the catalog…'); setError(null);
    try { await api.patchBook(book.id, indexPatch(loaded.read.info, loaded.read, book.title)); await done('Catalog updated from the file'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Sync failed'); }
    finally { setBusy(null); }
  }

  async function attach(file: File | undefined) {
    if (!file) return;
    const type = /\.pdf$/i.test(file.name) ? 'application/pdf' : /\.epub$/i.test(file.name) ? 'application/epub+zip' : null;
    if (!type) return setError('Choose a .pdf or .epub file.');
    setBusy('Uploading the file…'); setError(null);
    try {
      await api.replaceFile(book.id, file, type);
      await qc.invalidateQueries({ queryKey: ['book'] });
      showToast('File attached', { variant: 'success' });
    } catch (e) { setError(e instanceof Error ? e.message : 'Upload failed'); }
    finally { setBusy(null); }
  }

  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setTab = (t: 'details' | 'chapters') => void navigate({ search: { tab: t }, replace: true });

  return (
    <div className="page-wrapper">
      <PageHeader pretitle={<>Catalog · <Link to="/books/$bookId" params={{ bookId: book.slug }} style={{ color: 'var(--primary)' }}>{book.title}</Link></>} title="Edit book"
        actions={<Link className="btn btn-outline" to="/books/$bookId" params={{ bookId: book.slug }}>Cancel</Link>} />

      {isPdf && <div className="notice" style={{ marginBottom: 14 }}>
        <strong>PDF.</strong> Title, author, description and chapters are written <strong>into the PDF file itself</strong> (the catalog just mirrors them for search).
        {loaded && <> {loaded.read.pageCount} pages{loaded.read.outline.length ? ` · ${loaded.read.outline.length} chapters in the file` : ' · no chapters in the file yet'}.</>}
      </div>}
      {!isPdf && book.fileKey && <div className="notice warn" style={{ marginBottom: 14 }}>
        {book.format.toUpperCase()} details are stored in the library catalog only — they are not written back into the file (only PDFs support that).
      </div>}

      {!book.fileKey && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-body" style={{ display: 'grid', gap: 8 }}>
            <strong style={{ fontSize: 13.5 }}>No file attached</strong>
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Attach the PDF or EPUB for this record. For a PDF you can then edit its metadata and chapters here.</span>
            <input className="form-control" type="file" accept=".pdf,.epub" aria-label="Attach a file" disabled={!!busy} onChange={(e) => void attach(e.target.files?.[0])} />
          </div>
        </div>
      )}

      {phase === 'loading' && <p style={{ color: 'var(--text-muted)' }}><span className="reader-spinner" style={{ display: 'inline-block', verticalAlign: 'middle', marginInlineEnd: 8 }} /> Reading the PDF…</p>}
      {phase === 'error' && <div className="notice err" role="alert">{error} <button className="btn btn-outline btn-sm" onClick={() => void load()}>Try again</button></div>}

      {phase === 'ready' && (
        <>
          {isPdf && <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'details'} onClick={() => setTab('details')}>Details</button>
            <button role="tab" aria-selected={tab === 'chapters'} onClick={() => setTab('chapters')}>Chapters ({rows.length})</button>
          </div>}

          <div className="card" style={{ display: tab === 'details' || !isPdf ? undefined : 'none' }}>
            <div className="card-body" style={{ display: 'grid', gap: 14 }}>
              <div className="row col-2" style={{ gap: 14 }}>
                <div><label className="form-label" htmlFor="e-title">Title *</label><input id="e-title" className="form-control" value={form.title} onChange={set('title')} /></div>
                <div><label className="form-label" htmlFor="e-author">Author</label><input id="e-author" className="form-control" value={form.author} onChange={set('author')} /></div>
                <div><label className="form-label" htmlFor="e-pub">Publisher</label><input id="e-pub" className="form-control" value={form.publisher} onChange={set('publisher')} /></div>
                <div><label className="form-label" htmlFor="e-year">Year published</label><input id="e-year" className="form-control" inputMode="numeric" value={form.year} onChange={set('year')} /></div>
                <div><label className="form-label" htmlFor="e-isbn">ISBN</label><input id="e-isbn" className="form-control" value={form.isbn} onChange={set('isbn')} /></div>
                <div><label className="form-label" htmlFor="e-series">Series</label><input id="e-series" className="form-control" value={form.series} onChange={set('series')} /></div>
                <div><label className="form-label" htmlFor="e-genres">Genres (comma-separated)</label><input id="e-genres" className="form-control" value={form.genres} onChange={set('genres')} /></div>
                <div><label className="form-label" htmlFor="e-lang">Language</label><input id="e-lang" className="form-control" maxLength={5} value={form.language} onChange={set('language')} /></div>
              </div>
              <div><label className="form-label" htmlFor="e-desc">Description</label><textarea id="e-desc" className="form-control" rows={4} value={form.description} onChange={set('description')} /></div>
              {isbnWarning && <div className="notice warn">{isbnWarning}</div>}
            </div>
          </div>

          {isPdf && loaded && <div className="card" style={{ display: tab === 'chapters' ? undefined : 'none' }}>
            <div className="card-body"><OutlineEditor rows={rows} pageCount={loaded.read.pageCount} onChange={setRows} /></div>
          </div>}

          {problems.length > 0 && <div className="notice warn" style={{ marginTop: 14 }} role="status">{problems.join(' ')}</div>}
          {error && phase === 'ready' && <div className="notice err" style={{ marginTop: 14 }} role="alert">{error} {pendingSync && <button className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => void retrySync()}>Retry sync</button>}</div>}
          {addedInfo && <div className="notice ok" style={{ marginTop: 14 }}>This PDF had no document-info section, so one was added.</div>}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 16 }}>
            <button className="btn btn-primary" disabled={!!busy || problems.length > 0 || (!dirty && isPdf)} onClick={() => void save()}>{busy ?? (isPdf ? 'Save into the PDF' : 'Save changes')}</button>
            {isPdf && <button className="btn btn-ghost" disabled={!!busy || dirty} title={dirty ? 'Save or discard your edits first' : undefined} onClick={() => void syncFromFile()}>Update catalog from file</button>}
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{dirty ? 'Unsaved changes' : isPdf ? 'No changes' : ''}</span>
          </div>
        </>
      )}
    </div>
  );
}
