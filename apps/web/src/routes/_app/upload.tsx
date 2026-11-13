import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Icon } from '../../components/icons';
import { PageHeader } from '../../components/ui';
import { fmtBytes } from '../../lib/dates';
import { guessFromPath, lookupIsbn, normalizeIsbn, parseEpub, parsePdf, type IsbnInfo } from '../../lib/bookmeta';
import { meQuery } from '../../lib/queries';
import { MAX_BYTES, isBookFile, readDrop, targetPath, uploadBook, type Picked, type UploadJob } from '../../lib/uploader';

const Search = z.object({ tab: z.enum(['files', 'scan']).optional(), folder: z.string().optional(), scan: z.boolean().optional(), title: z.string().optional(), author: z.string().optional(), isbn: z.string().optional() });
export const Route = createFileRoute('/_app/upload')({ validateSearch: Search, component: AddBooks });

function AddBooks() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data: me } = useQuery(meQuery);
  const tab = search.tab ?? 'files';

  if (me && me.role !== 'admin') {
    return <div className="page-wrapper"><PageHeader title="Add books" /><p style={{ color: 'var(--text-muted)' }}>Only administrators can add books.</p></div>;
  }
  return (
    <div className="page-wrapper">
      <PageHeader pretitle="Catalog · Add books" title="Add books to the library" actions={<Link className="btn btn-outline" to="/files">Browse book files</Link>} />
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'files'} onClick={() => void navigate({ search: (p) => ({ ...p, tab: 'files' }) })}>Upload files &amp; folders</button>
        <button role="tab" aria-selected={tab === 'scan'} onClick={() => void navigate({ search: (p) => ({ ...p, tab: 'scan' }) })}>Scan ISBN / single book</button>
      </div>
      {tab === 'files' ? <BulkUpload initialFolder={search.folder ?? ''} /> : <SingleBook autoScan={!!search.scan} prefill={{ title: search.title, author: search.author, isbn: search.isbn }} />}
    </div>
  );
}

// ── Bulk: files and folders ───────────────────────────────────────
type Status = 'reading' | 'ready' | 'uploading' | 'done' | 'skipped' | 'error';
type Item = { id: string; file: File; rel: string; format: 'epub' | 'pdf'; title: string; author: string; job: Partial<UploadJob>; status: Status; progress: number; note?: string; slug?: string; noOutline?: boolean };

function BulkUpload({ initialFolder }: { initialFolder: string }) {
  const qc = useQueryClient();
  const [items, setItems] = useState<Item[]>([]);
  const [folder, setFolder] = useState(initialFolder);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dirInput = useRef<HTMLInputElement>(null);

  // `webkitdirectory` isn't in React's typings; set it imperatively.
  useEffect(() => { dirInput.current?.setAttribute('webkitdirectory', ''); }, []);

  const patch = useCallback((id: string, p: Partial<Item>) => setItems((cur) => cur.map((i) => (i.id === id ? { ...i, ...p } : i))), []);

  const addPicked = useCallback(async (picked: Picked[]) => {
    const books = picked.filter((p) => isBookFile(p.path));
    const ignored = picked.length - books.length;
    setNotice(ignored ? `${ignored} file${ignored > 1 ? 's' : ''} ignored — only .epub and .pdf are supported.` : null);

    const fresh: Item[] = books.map((p) => {
      const guess = guessFromPath(p.path);
      const tooBig = p.file.size > MAX_BYTES;
      return {
        id: crypto.randomUUID(), file: p.file, rel: p.path, format: /\.pdf$/i.test(p.path) ? 'pdf' : 'epub',
        title: guess.title, author: guess.author, job: {}, progress: 0,
        status: tooBig ? 'error' : 'reading',
        note: tooBig ? 'Larger than 100 MB (upload limit)' : undefined
      };
    });
    setItems((cur) => [...cur, ...fresh]);

    // Read metadata in the background: EPUBs two at a time; PDFs one at a time (each is loaded into WASM memory).
    const queue = fresh.filter((i) => i.status === 'reading');
    const epubs = queue.filter((i) => i.format === 'epub');
    const pdfs = queue.filter((i) => i.format === 'pdf');
    const epubWorker = async () => {
      for (let i = epubs.shift(); i; i = epubs.shift()) {
        const meta = await parseEpub(i.file);
        patch(i.id, {
          status: 'ready', title: meta.title ?? i.title, author: meta.author && meta.author !== 'Unknown' ? meta.author : i.author,
          job: { publisher: meta.publisher, year: meta.year, language: meta.language, isbn: meta.isbn, description: meta.description, toc: meta.toc, cover: meta.cover }
        });
      }
    };
    const pdfWorker = async () => {
      for (let i = pdfs.shift(); i; i = pdfs.shift()) {
        const meta = await parsePdf(i.file);
        patch(i.id, {
          status: 'ready', title: meta?.title ?? i.title, author: meta?.author ?? i.author, noOutline: meta ? !meta.hasOutline : undefined,
          job: meta ? { publisher: meta.publisher, year: meta.year, language: meta.language, isbn: meta.isbn, description: meta.description, toc: meta.toc, pages: meta.pages, genres: meta.genres, series: meta.series } : {}
        });
      }
    };
    await Promise.all([epubWorker(), epubWorker(), pdfWorker()]);
  }, [patch]);

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    await addPicked(await readDrop(e.dataTransfer));
  };

  const pending = items.filter((i) => i.status === 'ready');
  const reading = items.some((i) => i.status === 'reading');

  async function start() {
    setBusy(true);
    const queue = [...pending];
    const worker = async () => {
      for (let it = queue.shift(); it; it = queue.shift()) {
        patch(it.id, { status: 'uploading', progress: 0, note: undefined });
        try {
          const res = await uploadBook(
            { ...it.job, path: targetPath(folder, it.rel), file: it.file, format: it.format, title: it.title, author: it.author },
            (f) => patch(it.id, { progress: f })
          );
          patch(it.id, { status: res.status, slug: res.slug, note: res.note, progress: 1 });
        } catch (e) {
          patch(it.id, { status: 'error', note: e instanceof Error ? e.message : 'Upload failed' });
        }
      }
    };
    await Promise.all([worker(), worker()]);
    setBusy(false);
    for (const k of ['books', 'stats', 'files', 'continue']) void qc.invalidateQueries({ queryKey: [k] });
  }

  const done = items.filter((i) => i.status === 'done').length;
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div className="card">
        <div className="card-body">
          <div className="form-group" style={{ maxWidth: 460 }}>
            <label className="form-label" htmlFor="dest">Destination folder in the library (optional)</label>
            <input id="dest" className="form-control" placeholder="e.g. Fantasy/Le Guin" value={folder} onChange={(e) => setFolder(e.target.value)} />
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>Folders you upload keep their structure underneath this: <code>library/{folder ? `${folder}/` : ''}…</code></div>
          </div>

          <div className={over ? 'dropzone over' : 'dropzone'} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => void onDrop(e)}>
            <Icon name="files" size={28} />
            <div style={{ fontWeight: 600, marginTop: 6 }}>Drag EPUB / PDF files or whole folders here</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>or choose them below · up to 100 MB per file</div>
            <div className="actions">
              <button type="button" className="btn btn-primary" onClick={() => fileInput.current?.click()}>Choose files</button>
              <button type="button" className="btn btn-outline" onClick={() => dirInput.current?.click()}>Choose folder</button>
            </div>
            <input ref={fileInput} type="file" accept=".epub,.pdf,application/epub+zip,application/pdf" multiple hidden onChange={(e) => { void addPicked([...(e.target.files ?? [])].map((file) => ({ file, path: file.name }))); e.target.value = ''; }} />
            <input ref={dirInput} type="file" multiple hidden onChange={(e) => { void addPicked([...(e.target.files ?? [])].map((file) => ({ file, path: file.webkitRelativePath || file.name }))); e.target.value = ''; }} />
          </div>
          {notice && <p role="status" style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '10px 0 0' }}>{notice}</p>}
        </div>
      </div>

      {items.length > 0 && (
        <div className="card">
          <div className="card-header" style={{ flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div className="card-title">{items.length} file{items.length > 1 ? 's' : ''}</div>
              <div className="card-subtitle">{reading ? 'Reading metadata…' : `${done} uploaded · ${pending.length} ready · check titles and authors, then upload`}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setItems((cur) => cur.filter((i) => i.status === 'uploading'))}>Clear</button>
              <button className="btn btn-primary" disabled={busy || reading || pending.length === 0} onClick={() => void start()}>{busy ? 'Uploading…' : `Upload ${pending.length}`}</button>
            </div>
          </div>
          <div className="card-body" style={{ padding: '4px 16px 12px' }}>
            {items.map((i) => (
              <div key={i.id} className="up-row">
                <div style={{ minWidth: 0 }}>
                  <input className="form-control" style={{ height: 30 }} aria-label={`Title for ${i.rel}`} value={i.title} disabled={i.status !== 'ready'} onChange={(e) => patch(i.id, { title: e.target.value })} />
                  <div className="path" title={`library/${targetPath(folder, i.rel)}`}>library/{targetPath(folder, i.rel)} · {fmtBytes(i.file.size)}{i.job.toc?.length ? ` · ${i.job.toc.length} chapters` : ''}{i.noOutline ? ' · no chapters (add them after upload)' : ''}{i.job.pages ? ` · ${i.job.pages} pages` : ''}{i.job.cover ? ' · cover' : ''}</div>
                </div>
                <input className="form-control author" style={{ height: 30 }} aria-label={`Author for ${i.rel}`} value={i.author} disabled={i.status !== 'ready'} onChange={(e) => patch(i.id, { author: e.target.value })} />
                <div>
                  {i.status === 'uploading' && <div className="progress-line" role="progressbar" aria-valuenow={Math.round(i.progress * 100)}><i style={{ width: `${i.progress * 100}%` }} /></div>}
                  {i.status === 'done' && <Link to="/books/$bookId" params={{ bookId: i.slug ?? '' }} className="status status-green">added</Link>}
                  {i.status === 'skipped' && <span className="status status-yellow" title={i.note}>skipped</span>}
                  {i.status === 'error' && <span className="status status-red" title={i.note}>failed</span>}
                  {i.status === 'reading' && <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>reading…</span>}
                  {i.status === 'ready' && <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{i.format.toUpperCase()}</span>}
                  {i.note && (i.status === 'error' || i.status === 'skipped') && <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2 }}>{i.note}</div>}
                </div>
                <button className="x" type="button" aria-label={`Remove ${i.rel}`} disabled={i.status === 'uploading'} onClick={() => setItems((cur) => cur.filter((x) => x.id !== i.id))} style={{ background: 'none', border: 0, cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16 }}>×</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Single: scan / look up an ISBN, fill in details, optionally attach the file ──
type BarcodeDetectorLike = { detect: (v: CanvasImageSource) => Promise<{ rawValue: string }[]> };
declare const BarcodeDetector: (new (o: { formats: string[] }) => BarcodeDetectorLike) | undefined;

function SingleBook({ autoScan, prefill }: { autoScan: boolean; prefill: { title?: string; author?: string; isbn?: string } }) {
  const qc = useQueryClient();
  const [isbn, setIsbn] = useState(prefill.isbn ?? '');
  const [lookup, setLookup] = useState<{ state: 'idle' | 'busy' | 'none' | 'error'; msg?: string }>({ state: 'idle' });
  const [scanning, setScanning] = useState(false);
  const [scanErr, setScanErr] = useState<string | null>(null);
  const [f, setF] = useState({ title: prefill.title ?? '', author: prefill.author ?? '', publisher: '', year: '', pages: '', language: 'en', genres: '', description: '' });
  const [coverUrl, setCoverUrl] = useState<string | undefined>();
  const [file, setFile] = useState<File | null>(null);
  const [folder, setFolder] = useState('');
  const [format, setFormat] = useState<'epub' | 'pdf' | 'audio'>('epub');
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<{ ok: boolean; msg: string; slug?: string } | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const supported = typeof window !== 'undefined' && 'BarcodeDetector' in window;

  const apply = (info: IsbnInfo) => {
    setF((cur) => ({ ...cur, title: info.title, author: info.author, publisher: info.publisher ?? '', year: info.year ? String(info.year) : '', pages: info.pages ? String(info.pages) : '', genres: info.genres.join(', '), description: info.description ?? cur.description }));
    setCoverUrl(info.coverUrl);
  };

  const doLookup = async (raw: string) => {
    const n = normalizeIsbn(raw);
    if (!n) return setLookup({ state: 'error', msg: 'That doesn’t look like a valid ISBN (check the digits).' });
    setIsbn(n);
    setLookup({ state: 'busy' });
    try {
      const info = await lookupIsbn(n);
      if (!info) return setLookup({ state: 'none', msg: 'No match found — fill the details in manually.' });
      apply(info);
      setLookup({ state: 'idle' });
    } catch {
      setLookup({ state: 'error', msg: 'Lookup failed (offline?). You can fill the details in manually.' });
    }
  };

  // Camera scanning with the built-in BarcodeDetector (Chrome/Edge/Android). Others use manual entry.
  useEffect(() => {
    if (!scanning) return;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;
    (async () => {
      try {
        if (!BarcodeDetector) throw new Error('unsupported');
        const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a'] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (cancelled || !video.current) return stream.getTracks().forEach((t) => t.stop());
        video.current.srcObject = stream;
        await video.current.play();
        timer = setInterval(async () => {
          if (!video.current) return;
          const hit = (await detector.detect(video.current).catch(() => [])).map((c) => normalizeIsbn(c.rawValue)).find(Boolean);
          if (hit) { setScanning(false); void doLookup(hit); }
        }, 350);
      } catch (e) {
        setScanErr(e instanceof Error && e.name === 'NotAllowedError' ? 'Camera permission was denied.' : 'Camera scanning isn’t available in this browser — type the ISBN instead.');
        setScanning(false);
      }
    })();
    return () => { cancelled = true; clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, [scanning]);

  useEffect(() => { if (autoScan && supported) setScanning(true); }, []);
  useEffect(() => { if (prefill.isbn && normalizeIsbn(prefill.isbn)) void doLookup(prefill.isbn); }, []); // from an acquisition request

  const pickFile = async (picked: File | null) => {
    setFile(picked);
    if (!picked) return;
    const fmt = /\.pdf$/i.test(picked.name) ? 'pdf' : 'epub';
    setFormat(fmt);
    const g = guessFromPath(picked.name);
    if (!f.title) setF((c) => ({ ...c, title: g.title, author: c.author || g.author }));
    if (fmt === 'epub') {
      const meta = await parseEpub(picked);
      setF((c) => ({ ...c, title: c.title || meta.title || g.title, author: c.author || meta.author || g.author, publisher: c.publisher || meta.publisher || '' }));
    } else {
      const meta = await parsePdf(picked);
      if (meta) setF((c) => ({ ...c, title: c.title || meta.title || g.title, author: c.author || meta.author || g.author, publisher: c.publisher || meta.publisher || '', year: c.year || (meta.year ? String(meta.year) : ''), pages: c.pages || (meta.pages ? String(meta.pages) : ''), genres: c.genres || (meta.genres ?? []).join(', '), description: c.description || meta.description || '' }));
    }
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.title.trim()) return;
    setResult(null);
    setProgress(0);
    try {
      const meta = file && format === 'epub' ? await parseEpub(file) : null;
      const pdfMeta = file && format === 'pdf' ? await parsePdf(file) : null;
      let cover = meta?.cover;
      if (!cover && coverUrl) cover = await fetch(coverUrl).then((r) => (r.ok ? r.blob() : undefined)).catch(() => undefined); // best effort (CORS)
      const rel = file ? (file.name) : '';
      const res = await uploadBook(
        {
          path: file ? targetPath(folder, rel) : '', file: file ?? undefined, format, title: f.title, author: f.author,
          publisher: f.publisher || undefined, year: Number(f.year) || undefined, pages: Number(f.pages) || pdfMeta?.pages || undefined, language: f.language || 'en',
          isbn: normalizeIsbn(isbn) ?? pdfMeta?.isbn ?? undefined, description: f.description || meta?.description || pdfMeta?.description || undefined, series: pdfMeta?.series,
          genres: f.genres.split(',').map((s) => s.trim()).filter(Boolean), toc: meta?.toc ?? pdfMeta?.toc, cover: cover && /^image\/(jpeg|png|webp)$/.test(cover.type) ? cover : undefined
        },
        setProgress
      );
      setResult(res.status === 'done' ? { ok: true, msg: 'Book added to the library.', slug: res.slug } : { ok: false, msg: res.note ?? 'Skipped.' });
      if (res.status === 'done') {
        setF({ title: '', author: '', publisher: '', year: '', pages: '', language: 'en', genres: '', description: '' });
        setIsbn(''); setFile(null); setCoverUrl(undefined);
        for (const k of ['books', 'stats', 'files']) void qc.invalidateQueries({ queryKey: [k] });
      }
    } catch (err) {
      setResult({ ok: false, msg: err instanceof Error ? err.message : 'Could not add the book.' });
    } finally {
      setProgress(null);
    }
  }

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((c) => ({ ...c, [k]: e.target.value }));
  return (
    <div className="row col-8-4" style={{ alignItems: 'start' }}>
      <form className="card" onSubmit={submit}>
        <div className="card-header"><div><div className="card-title">Book details</div><div className="card-subtitle">Scan or type an ISBN to fill these in automatically</div></div></div>
        <div className="card-body" style={{ display: 'grid', gap: 14 }}>
          <div>
            <label className="form-label" htmlFor="isbn">ISBN</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input id="isbn" className="form-control" style={{ flex: '1 1 180px' }} inputMode="numeric" placeholder="978…" value={isbn} onChange={(e) => setIsbn(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void doLookup(isbn); } }} />
              <button type="button" className="btn btn-outline" disabled={!isbn || lookup.state === 'busy'} onClick={() => void doLookup(isbn)}>{lookup.state === 'busy' ? 'Looking up…' : 'Look up'}</button>
              <button type="button" className="btn btn-primary" onClick={() => { setScanErr(null); setScanning((s) => !s); }}>{scanning ? 'Stop camera' : 'Scan barcode'}</button>
            </div>
            {!supported && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>Camera scanning needs Chrome, Edge or an Android browser — manual entry works everywhere.</div>}
            {(scanErr || lookup.msg) && <div role="status" style={{ fontSize: 12.5, color: lookup.state === 'error' || scanErr ? 'var(--red)' : 'var(--text-muted)', marginTop: 6 }}>{scanErr ?? lookup.msg}</div>}
          </div>
          {scanning && <video ref={video} className="scan-video" muted playsInline aria-label="Camera preview" />}

          <div className="row col-2" style={{ gap: 14 }}>
            <div><label className="form-label" htmlFor="t">Title *</label><input id="t" className="form-control" required value={f.title} onChange={set('title')} /></div>
            <div><label className="form-label" htmlFor="a">Author</label><input id="a" className="form-control" value={f.author} onChange={set('author')} /></div>
            <div><label className="form-label" htmlFor="p">Publisher</label><input id="p" className="form-control" value={f.publisher} onChange={set('publisher')} /></div>
            <div><label className="form-label" htmlFor="y">Year</label><input id="y" className="form-control" inputMode="numeric" value={f.year} onChange={set('year')} /></div>
            <div><label className="form-label" htmlFor="pg">Pages</label><input id="pg" className="form-control" inputMode="numeric" value={f.pages} onChange={set('pages')} /></div>
            <div><label className="form-label" htmlFor="g">Genres (comma-separated)</label><input id="g" className="form-control" value={f.genres} onChange={set('genres')} /></div>
          </div>
          <div><label className="form-label" htmlFor="d">Description</label><textarea id="d" className="form-control" rows={3} value={f.description} onChange={set('description')} /></div>

          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 14, display: 'grid', gap: 10 }}>
            <label className="form-label" htmlFor="file">Book file (optional — you can add it later)</label>
            <input id="file" className="form-control" type="file" accept=".epub,.pdf" onChange={(e) => void pickFile(e.target.files?.[0] ?? null)} />
            {file ? (
              <div className="row col-2" style={{ gap: 14 }}>
                <div><label className="form-label" htmlFor="fol">Folder in library</label><input id="fol" className="form-control" placeholder="e.g. Fantasy" value={folder} onChange={(e) => setFolder(e.target.value)} /></div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'end' }}>{file.name} · {fmtBytes(file.size)}</div>
              </div>
            ) : (
              <div style={{ maxWidth: 220 }}><label className="form-label" htmlFor="fmt">Format</label>
                <select id="fmt" className="form-control" value={format} onChange={(e) => setFormat(e.target.value as typeof format)}><option value="epub">EPUB</option><option value="pdf">PDF</option><option value="audio">Audio</option></select></div>
            )}
          </div>

          {progress !== null && <div className="progress-line"><i style={{ width: `${progress * 100}%` }} /></div>}
          {result && <div role="status" style={{ fontSize: 13, color: result.ok ? 'var(--green)' : 'var(--red)' }}>{result.msg} {result.slug && <Link to="/books/$bookId" params={{ bookId: result.slug }}>Open it →</Link>}</div>}
          <div><button className="btn btn-primary" type="submit" disabled={!f.title.trim() || progress !== null}>{progress !== null ? 'Adding…' : 'Add to library'}</button></div>
        </div>
      </form>

      <div className="card">
        <div className="card-header"><div className="card-title">Cover</div></div>
        <div className="card-body" style={{ textAlign: 'center' }}>
          {coverUrl ? <img className="book-cover" src={coverUrl} alt="Cover preview" style={{ maxWidth: 160 }} /> : <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>A cover is fetched from Open Library when available, or taken from the EPUB file.</p>}
        </div>
      </div>
    </div>
  );
}
