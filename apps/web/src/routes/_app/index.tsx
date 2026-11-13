import { Link, createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { BookCard } from '../../components/BookCard';
import { Icon } from '../../components/icons';
import { BookCover, PageHeader, ProgressBar, StatCard } from '../../components/ui';
import { booksQuery, continueQuery, meQuery, statsQuery } from '../../lib/queries';

export const Route = createFileRoute('/_app/')({ component: Overview });

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

function Overview() {
  const { data: me } = useQuery(meQuery);
  const { data: stats } = useQuery(statsQuery);
  const { data: reading } = useQuery(continueQuery);
  const { data: recent } = useQuery(booksQuery({ sort: 'recent', pageSize: 6 }));
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="page-wrapper">
      <PageHeader
        pretitle={today}
        title={`${greeting()}, ${me?.name.split(' ')[0] ?? ''}`}
        actions={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {me?.role === 'admin' && (
              <>
                <Link className="btn btn-outline" to="/upload" search={{ tab: 'scan', scan: true }}><Icon name="book" size={14} /> Scan ISBN</Link>
                <Link className="btn btn-outline" to="/upload"><Icon name="files" size={14} /> Add book</Link>
              </>
            )}
            <Link className="btn btn-primary" to="/catalog">Browse the catalog</Link>
          </div>
        }
      />

      <div className="row col-4">
        <StatCard tone="teal" icon={<Icon name="book" />} label="Books in library" value={stats?.totalBooks ?? '—'} sub={`${stats?.addedThisMonth ?? 0} added this month`} />
        <StatCard tone="blue" icon={<Icon name="books" />} label="Currently reading" value={stats?.reading ?? '—'} />
        <StatCard tone="green" icon={<Icon name="tables" />} label="Books finished" value={stats?.finished ?? '—'} />
        <StatCard tone="yellow" icon={<Icon name="pages" />} label="Want to read" value={stats?.queued ?? '—'} />
      </div>

      <div className="row col-8-4">
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Recently added</div>
              <div className="card-subtitle">Newest titles in the library</div>
            </div>
          </div>
          <div className="card-body">
            <div className="book-shelf">{recent?.items.map((b) => <BookCard key={b.id} book={b} />)}</div>
            {recent && recent.items.length === 0 && (
              <div style={{ textAlign: 'center', padding: '28px 12px' }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Your library is empty</div>
                <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 auto 14px', maxWidth: 380 }}>
                  {me?.role === 'admin' ? 'Add your first books — drag in EPUB or PDF files, or whole folders, or add one by ISBN.' : 'No books have been added yet. An administrator can add them.'}
                </p>
                {me?.role === 'admin' && <Link className="btn btn-primary" to="/upload">Add books</Link>}
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Continue reading</div>
              <div className="card-subtitle">{reading?.length ?? 0} in progress</div>
            </div>
          </div>
          <div className="card-body" style={{ padding: '6px 16px' }}>
            {reading?.length === 0 && <p style={{ padding: '14px 0', color: 'var(--text-muted)', fontSize: 13 }}>Nothing in progress. Open a book to start.</p>}
            {reading?.map((b) => (
              <Link key={b.id} className="continue-item" to="/books/$bookId" params={{ bookId: b.slug }} style={{ color: 'inherit', textDecoration: 'none' }}>
                <BookCover book={b} small />
                <div className="continue-meta">
                  <div className="continue-title">{b.title}</div>
                  <div className="continue-author">{b.author}</div>
                  <ProgressBar percent={b.progress?.percent ?? 0} />
                  <div className="continue-sub"><span>{Math.round(b.progress?.percent ?? 0)}% read</span></div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
