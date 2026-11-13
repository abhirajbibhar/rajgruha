import { useEffect, useState } from 'react';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { createColumnHelper, flexRender, rowSortingFeature, tableFeatures, useTable, type SortingState } from '@tanstack/react-table';
import { z } from 'zod';
import { BookFormat, BookSort, type Book } from '@rajgruha/shared';
import { Icon } from '../../components/icons';
import { FormatTag, PageHeader } from '../../components/ui';
import { FORMAT_LABEL } from '../../lib/format';
import { booksQuery } from '../../lib/queries';

const Search = z.object({
  q: z.string().optional(),
  format: BookFormat.optional(),
  sort: BookSort.optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  size: z.coerce.number().int().min(10).max(100).optional()
});

export const Route = createFileRoute('/_app/inventory')({ validateSearch: Search, component: Inventory });

// Server-side table: sorting, search, filtering and paging all happen in the API (manualSorting).
const features = tableFeatures({ rowSortingFeature });
const col = createColumnHelper<typeof features, Book>();

// column id → API sort key
const SORT_KEY: Record<string, BookSort> = { title: 'title', author: 'author', genre: 'genre', format: 'format', pages: 'pages', rating: 'rating', status: 'status', added: 'recent' };
const ID_FOR_SORT = Object.fromEntries(Object.entries(SORT_KEY).map(([id, key]) => [key, id]));

const columns = col.columns([
  col.accessor((b) => b.title, {
    id: 'title', header: 'Title',
    cell: ({ row }) => (
      <Link className="cell-strong cell-trunc wide" to="/books/$bookId" params={{ bookId: row.original.slug }} title={row.original.title}>{row.original.title}</Link>
    )
  }),
  col.accessor((b) => b.author, { id: 'author', header: 'Author', cell: ({ row }) => <span className="cell-trunc" title={row.original.author}>{row.original.author}</span> }),
  col.accessor((b) => b.genres.join(', '), { id: 'genre', header: 'Genre', cell: ({ row }) => <span className="cell-trunc" title={row.original.genres.join(', ')}>{row.original.genres.join(', ') || '—'}</span> }),
  col.accessor((b) => b.format, { id: 'format', header: 'Format', cell: ({ row }) => <FormatTag format={row.original.format} /> }),
  col.accessor((b) => b.pages ?? 0, { id: 'pages', header: 'Pages', cell: ({ row }) => row.original.pages ?? '—' }),
  col.accessor((b) => b.rating, { id: 'rating', header: 'Rating', cell: ({ row }) => `★ ${row.original.rating.toFixed(1)}` }),
  col.accessor((b) => b.progress?.status ?? '', {
    id: 'status', header: 'Status',
    cell: ({ row }) => {
      const s = row.original.progress?.status;
      return s ? <span className={`status status-${s === 'finished' ? 'blue' : s === 'reading' ? 'green' : 'yellow'}`}>{s}</span> : <span style={{ color: 'var(--text-muted)' }}>—</span>;
    }
  }),
  col.accessor((b) => b.addedAt, { id: 'added', header: 'Added', cell: ({ row }) => new Date(row.original.addedAt).toLocaleDateString() })
]);

const NO_BOOKS: Book[] = []; // stable identity while loading

function Inventory() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const set = (patch: Partial<z.infer<typeof Search>>) => void navigate({ search: (prev) => ({ ...prev, page: undefined, ...patch }) });

  const sort = search.sort ?? 'title';
  const dir = search.dir ?? 'asc';
  const page = search.page ?? 1;
  const size = search.size ?? 25;

  const { data, isFetching, isError } = useQuery(booksQuery({ q: search.q, format: search.format, sort, dir, page, pageSize: size }));

  const sorting: SortingState = [{ id: ID_FOR_SORT[sort] ?? 'title', desc: dir === 'desc' }];
  const table = useTable({
    features,
    columns,
    data: data?.items ?? NO_BOOKS,
    manualSorting: true,
    enableMultiSort: false,
    state: { sorting },
    onSortingChange: (updater) => {
      const next = (typeof updater === 'function' ? updater(sorting) : updater)[0];
      if (!next) return set({ sort: 'title', dir: 'asc' });
      set({ sort: SORT_KEY[next.id] ?? 'title', dir: next.desc ? 'desc' : 'asc' });
    }
  });

  const [text, setText] = useState(search.q ?? '');
  useEffect(() => setText(search.q ?? ''), [search.q]);
  useEffect(() => {
    if (text === (search.q ?? '')) return;
    const t = setTimeout(() => set({ q: text.trim() || undefined }), 300);
    return () => clearTimeout(t);
  }, [text]);

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / size));
  const first = total ? (page - 1) * size + 1 : 0;
  const last = Math.min(total, page * size);

  return (
    <div className="page-wrapper">
      <PageHeader pretitle="Catalog · Books" title="Books" actions={<Link className="btn btn-primary" to="/upload"><Icon name="files" size={14} /> Add books</Link>} />

      <div className="card">
        <div className="card-header" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div className="card-title">All books</div>
            <div className="card-subtitle">{data ? `${total} titles` : 'Loading…'}{isFetching && ' · updating'}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginLeft: 'auto' }}>
            <div className="inline-search">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="7" cy="7" r="5" /><path d="M11 11l3.5 3.5" /></svg>
              <input type="search" placeholder="Search title, author, ISBN…" aria-label="Search books" value={text} onChange={(e) => setText(e.target.value)} />
            </div>
            <select className="form-control" style={{ width: 130, height: 32 }} aria-label="Format" value={search.format ?? ''} onChange={(e) => set({ format: (e.target.value || undefined) as z.infer<typeof Search>['format'] })}>
              <option value="">All formats</option>
              {BookFormat.options.map((f) => <option key={f} value={f}>{FORMAT_LABEL[f]}</option>)}
            </select>
          </div>
        </div>

        <div className="card-body p-0">
          <div className="table-scroll">
            <table className="table" style={{ minWidth: 760 }}>
              <thead>
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {hg.headers.map((h) => {
                      const dirNow = h.column.getIsSorted();
                      return (
                        <th key={h.id} onClick={h.column.getToggleSortingHandler()} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} aria-sort={dirNow === 'asc' ? 'ascending' : dirNow === 'desc' ? 'descending' : 'none'}>
                          {flexRender(h.column.columnDef.header, h.getContext())}{dirNow === 'asc' ? ' ▲' : dirNow === 'desc' ? ' ▼' : ''}
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <tr key={row.id}>{row.getAllCells().map((cell) => <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>
                ))}
                {data && data.items.length === 0 && <tr><td colSpan={columns.length} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>No books match.</td></tr>}
                {isError && <tr><td colSpan={columns.length} style={{ textAlign: 'center', color: 'var(--red)', padding: 24 }}>Could not load books.</td></tr>}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderTop: '1px solid var(--border-color)' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{first}–{last} of {total}</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select className="form-control" style={{ width: 118, height: 30 }} aria-label="Rows per page" value={size} onChange={(e) => set({ size: Number(e.target.value) })}>
                {[25, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
              </select>
              <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => void navigate({ search: (p) => ({ ...p, page: page - 1 }) })}>←</button>
              <span style={{ fontSize: 12 }}>{page} / {pages}</span>
              <button className="btn btn-outline btn-sm" disabled={page >= pages} onClick={() => void navigate({ search: (p) => ({ ...p, page: page + 1 }) })}>→</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
