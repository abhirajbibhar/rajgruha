import { Suspense, lazy, useEffect, useRef } from 'react';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '../../lib/api';
import { PAGE_HREF } from '../../lib/pdf/outlineOps';
import { bookQuery } from '../../lib/queries';
import { useReadingSession } from '../../lib/useReadingSession';

// The readers pull in epub.js / the PDF viewer (several MB). They only ever run in the browser, so on the
// Cloudflare server build they're replaced by a stub and dropped from the Worker bundle.
const serverBuild = import.meta.env.SSR && import.meta.env.MODE !== 'test';
const Stub = () => null;
const EpubReader = serverBuild ? (Stub as never) : lazy(() => import('../../components/readers/EpubReader').then((m) => ({ default: m.EpubReader })));
const PdfReader = serverBuild ? (Stub as never) : lazy(() => import('../../components/readers/PdfReader').then((m) => ({ default: m.PdfReader })));

export const Route = createFileRoute('/_app/read/$bookId')({
  validateSearch: z.object({ href: z.string().optional() }),
  component: Reader
});

function Reader() {
  const { bookId } = Route.useParams();
  const { href } = Route.useSearch();
  const qc = useQueryClient();
  const { data: book, isPending } = useQuery(bookQuery(bookId));
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef<{ percent: number; location: string } | null>(null);
  const percent = useRef(0);
  const id = book?.id;
  const readable = !!book?.fileKey && book.format !== 'audio';
  const { touch } = useReadingSession(readable ? id : undefined, () => percent.current);

  useEffect(() => { percent.current = book?.progress?.percent ?? 0; }, [book?.id]);

  const flush = () => {
    if (!id || !latest.current) return;
    const { percent: p, location } = latest.current;
    latest.current = null;
    void api.saveProgress(id, { percent: p, location }).then((b) => {
      qc.setQueryData(['book', bookId], b);
      for (const k of ['continue', 'books', 'stats']) void qc.invalidateQueries({ queryKey: [k] });
    });
  };

  // Debounce progress writes (EPUB fires on every page turn); flush on leave.
  const onProgress = (p: number, location: string) => {
    percent.current = p;
    latest.current = { percent: p, location };
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 1500);
  };
  useEffect(() => () => { clearTimeout(timer.current); flush(); }, [id]);

  // Leaving the reader: refresh the log/analytics caches so new time shows up straight away.
  useEffect(() => () => { for (const k of ['log', 'analytics']) void qc.invalidateQueries({ queryKey: [k] }); }, [qc]);

  // PDFs: the viewer manages its own page state, so just mark the book as started.
  useEffect(() => {
    if (book?.format === 'pdf' && !book.progress) void api.saveProgress(book.id, { percent: 0, status: 'reading' });
  }, [book?.id]);

  let body;
  if (isPending) body = <div className="reader-loading"><span className="reader-spinner" /> Loading…</div>;
  else if (!book) body = <div className="reader-loading">Book not found.</div>;
  else if (!book.fileKey) {
    body = (
      <div className="reader-loading" style={{ flexDirection: 'column', textAlign: 'center', gap: 6 }}>
        <p>“{book.title}” has no file attached yet.</p>
        <p style={{ fontSize: 12 }}>Add one from <Link to="/upload">Add books</Link>, or <Link to="/books/$bookId" params={{ bookId }}>go back</Link>.</p>
      </div>
    );
  } else if (book.format === 'epub') {
    body = <EpubReader url={api.fileUrl(book.id)} initialLocation={book.progress?.location ?? null} initialHref={href} toc={book.toc} onProgress={onProgress} onActivity={touch} />;
  } else if (book.format === 'pdf') {
    const wanted = PAGE_HREF.exec(href ?? '') ?? PAGE_HREF.exec(book.progress?.location ?? '');
    body = (
      <PdfReader
        url={api.fileUrl(book.id)}
        initialPage={wanted ? Number(wanted[1]) : 1}
        onPage={(page, total) => { touch(); onProgress(Math.round((page / Math.max(1, total)) * 1000) / 10, `page:${page}`); }}
      />
    );
  } else {
    body = <div className="reader-loading">Audiobooks aren’t playable in the reader yet.</div>;
  }

  return (
    <div className="reader-page">
      <div className="reader-stage"><Suspense fallback={<div className="reader-loading"><span className="reader-spinner" /> Loading reader…</div>}>{body}</Suspense></div>
    </div>
  );
}
