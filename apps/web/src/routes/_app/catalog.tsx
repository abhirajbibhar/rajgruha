import { useEffect, useRef, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { BookFormat, BookSort, ReadingStatus } from '@rajgruha/shared';
import { BookCard } from '../../components/BookCard';
import { Icon } from '../../components/icons';
import { PageHeader } from '../../components/ui';
import { FORMAT_LABEL } from '../../lib/format';
import { booksQuery, facetsQuery } from '../../lib/queries';

const Search = z.object({
  q: z.string().optional(),
  format: BookFormat.optional(),
  genre: z.string().optional(),
  status: ReadingStatus.optional(),
  sort: BookSort.optional(),
  page: z.coerce.number().int().min(1).optional()
});
type Search = z.infer<typeof Search>;

export const Route = createFileRoute('/_app/catalog')({ validateSearch: Search, component: Catalog });

const SORT_LABEL: Record<BookSort, string> = {
  recent: 'Recently added', title: 'Title (A–Z)', author: 'Author (A–Z)', rating: 'Highest rated', popular: 'Most rated',
  format: 'Format', pages: 'Longest first', status: 'Reading status', genre: 'Genre'
};
const CATALOG_SORTS: BookSort[] = ['recent', 'title', 'author', 'rating', 'popular', 'pages'];
const STATUS_LABEL = { reading: 'Reading now', queued: 'Want to read', finished: 'Finished' } as const;

function Catalog() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const set = (patch: Partial<Search>) => void navigate({ search: (prev) => ({ ...prev, page: undefined, ...patch }) });

  const { data, isFetching, isError } = useQuery(
    booksQuery({ q: search.q, format: search.format, genre: search.genre, status: search.status, sort: search.sort ?? 'recent', page: search.page ?? 1 })
  );

  // Debounced search box → URL
  const [text, setText] = useState(search.q ?? '');
  useEffect(() => setText(search.q ?? ''), [search.q]);
  useEffect(() => {
    if (text === (search.q ?? '')) return;
    const t = setTimeout(() => set({ q: text.trim() || undefined }), 250);
    return () => clearTimeout(t);
  }, [text]);

  const active: { key: keyof Search; label: string }[] = [];
  if (search.genre) active.push({ key: 'genre', label: search.genre });
  if (search.format) active.push({ key: 'format', label: FORMAT_LABEL[search.format] });
  if (search.status) active.push({ key: 'status', label: STATUS_LABEL[search.status] });

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const page = search.page ?? 1;

  return (
    <div className="page-wrapper">
      <PageHeader pretitle="Library · Catalog" title="Browse the catalog" />

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-body" style={{ padding: '12px 16px' }}>
          <div className="catalog-toolbar">
            <FilterMenu search={search} onChange={set} count={active.length} />
            <div className="catalog-search">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="7" cy="7" r="5" /><path d="M11 11l3.5 3.5" /></svg>
              <input type="search" placeholder="Search title, author, ISBN…" aria-label="Search the catalog" value={text} onChange={(e) => setText(e.target.value)} />
            </div>
            <select className="form-control" style={{ width: 156, height: 32 }} aria-label="Sort books" value={search.sort ?? 'recent'} onChange={(e) => set({ sort: BookSort.parse(e.target.value) })}>
              {CATALOG_SORTS.map((s) => <option key={s} value={s}>{SORT_LABEL[s]}</option>)}
            </select>
          </div>

          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            {active.map((a) => (
              <span key={a.key} className="chip chip-primary active" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {a.label}
                <button type="button" aria-label={`Remove filter ${a.label}`} onClick={() => set({ [a.key]: undefined })} style={{ all: 'unset', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}>×</button>
              </span>
            ))}
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
              {data ? `${data.total} ${data.total === 1 ? 'book' : 'books'}` : '…'}{isFetching && ' · updating'}
            </span>
          </div>
        </div>
      </div>

      {isError && <p role="alert" style={{ color: 'var(--red)' }}>Could not load the catalog.</p>}
      {data?.items.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No books match these filters.</p>}
      <div className="book-shelf">{data?.items.map((b) => <BookCard key={b.id} book={b} />)}</div>

      {pages > 1 && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center', marginTop: 24 }}>
          <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => void navigate({ search: (p) => ({ ...p, page: page - 1 }) })}>← Previous</button>
          <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Page {page} of {pages}</span>
          <button className="btn btn-outline btn-sm" disabled={page >= pages} onClick={() => void navigate({ search: (p) => ({ ...p, page: page + 1 }) })}>Next →</button>
        </div>
      )}
    </div>
  );
}

/** Filters live in one dropdown instead of a wall of chips. Closes on outside click / Esc. */
function FilterMenu({ search, onChange, count }: { search: Search; onChange: (p: Partial<Search>) => void; count: number }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const { data: facets } = useQuery(facetsQuery);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div className="filter-wrap" ref={wrap}>
      <button type="button" className="btn btn-outline btn-sm" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="forms" size={14} /> Filters{count > 0 && <span className="filter-count">{count}</span>}
      </button>
      {open && (
        <div className="filter-panel" role="dialog" aria-label="Filter books">
          <div>
            <label className="form-label" htmlFor="f-genre">Genre</label>
            <select id="f-genre" className="form-control" value={search.genre ?? ''} onChange={(e) => onChange({ genre: e.target.value || undefined })}>
              <option value="">{facets?.genres.length === 0 ? 'No genres yet' : 'All genres'}</option>
              {facets?.genres.map((g) => <option key={g.name} value={g.name}>{g.name} ({g.count})</option>)}
              {search.genre && !facets?.genres.some((g) => g.name === search.genre) && <option value={search.genre}>{search.genre}</option>}
            </select>
          </div>
          <div>
            <label className="form-label" htmlFor="f-format">Format</label>
            <select id="f-format" className="form-control" value={search.format ?? ''} onChange={(e) => onChange({ format: (e.target.value || undefined) as Search['format'] })}>
              <option value="">Any format</option>
              {(facets?.formats.length ? facets.formats.map((f) => f.format) : BookFormat.options).map((f) => <option key={f} value={f}>{FORMAT_LABEL[f]}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label" htmlFor="f-status">My status</label>
            <select id="f-status" className="form-control" value={search.status ?? ''} onChange={(e) => onChange({ status: (e.target.value || undefined) as Search['status'] })}>
              <option value="">Any status</option>
              {ReadingStatus.options.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button type="button" className="btn btn-ghost btn-sm" disabled={!count} onClick={() => onChange({ genre: undefined, format: undefined, status: undefined })}>Clear all</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
