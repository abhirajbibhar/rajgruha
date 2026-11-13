import { useState } from 'react';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Icon } from '../../components/icons';
import { BookCover, FormatTag, PageHeader, ProgressBar } from '../../components/ui';
import { compact } from '../../lib/format';
import { bookQuery, meQuery } from '../../lib/queries';

export const Route = createFileRoute('/_app/books/$bookId')({ component: BookDetail });

function BookDetail() {
  const { bookId } = Route.useParams();
  const { data: book, isPending, isError } = useQuery(bookQuery(bookId));
  const { data: me } = useQuery(meQuery);
  const admin = me?.role === 'admin';
  const [tab, setTab] = useState<'about' | 'chapters'>('about');

  if (isPending) return <div className="page-wrapper">Loading…</div>;
  if (isError) return <div className="page-wrapper"><h1 className="page-title">Book not found</h1><Link to="/catalog">← Back to catalog</Link></div>;

  const p = book.progress;
  const readable = book.format !== 'audio';
  const meta: [string, string | number | null][] = [
    ['Publisher', book.publisher], ['First published', book.publishedYear], ['Pages', book.pages],
    ['Language', book.language.toUpperCase()], ['ISBN', book.isbn], ['Series', book.series],
    ['Added', new Date(book.addedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })]
  ];

  return (
    <div className="page-wrapper">
      <PageHeader
        pretitle={<>Catalog · <Link to="/catalog" style={{ color: 'var(--primary)' }}>All books</Link></>}
        title={book.title}
        actions={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {admin && <Link className="btn btn-primary" to="/edit/$bookId" params={{ bookId: book.slug }}>Edit details &amp; chapters</Link>}
            <Link className="btn btn-outline" to="/catalog">← Back to catalog</Link>
          </div>
        }
      />

      <div className="book-hero">
        <div className="card">
          <div className="book-hero-art" style={{ borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0' }}>
            <BookCover book={book} />
          </div>
          <div className="card-body" style={{ padding: 16 }}>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 14 }}><FormatTag format={book.format} /></div>
            {readable ? (
              <Link className="btn btn-primary" to="/read/$bookId" params={{ bookId: book.slug }} style={{ width: '100%', justifyContent: 'center' }}>
                <Icon name="book" size={14} /> {p?.status === 'reading' ? 'Continue reading' : 'Read now'}
              </Link>
            ) : (
              <button className="btn btn-outline" disabled style={{ width: '100%', justifyContent: 'center' }}>Audio player coming soon</button>
            )}
            {p && p.status !== 'queued' && (
              <>
                <div style={{ marginTop: 16 }}><ProgressBar percent={p.percent} /></div>
                <div className="continue-sub"><span>{p.status === 'finished' ? 'Finished' : 'In progress'}</span><span>{Math.round(p.percent)}%</span></div>
              </>
            )}
            <div style={{ marginTop: 12, fontSize: 11.5, color: 'var(--text-muted)' }}>
              <span className="availability"><span className="dot" /> {book.fileKey ? 'File available' : 'No file uploaded yet'}</span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-body" style={{ padding: 20 }}>
            <div className="product-meta">
              {book.genres.map((g) => <span key={g} className="chip chip-primary active" style={{ fontWeight: 500 }}>{g}</span>)}
              <span className="rating">★ <small>{book.rating.toFixed(1)} · {compact(book.ratingCount)} ratings</small></span>
            </div>
            <h2 className="product-title">{book.title}</h2>
            <p className="product-tagline">{[book.author, book.series, book.publishedYear].filter(Boolean).join(' · ')}</p>

            <div className="tabs" role="tablist" style={{ marginTop: 14 }}>
              <button role="tab" aria-selected={tab === 'about'} onClick={() => setTab('about')}>About</button>
              <button role="tab" aria-selected={tab === 'chapters'} onClick={() => setTab('chapters')}>Chapters{book.toc.length > 0 && ` (${book.toc.length})`}</button>
            </div>

            {tab === 'about' && (
              <div role="tabpanel">
                <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 14px' }}>
                  {book.description ?? 'No description yet.'}
                </p>
                <div className="book-meta-grid">
                  {meta.filter(([, v]) => v !== null && v !== '').map(([k, v]) => (
                    <div key={k}><div className="k">{k}</div><div className="v">{v}</div></div>
                  ))}
                </div>
              </div>
            )}

            {tab === 'chapters' && (
              <div role="tabpanel">
                {book.toc.length === 0 ? (
                  <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    {book.format === 'epub' ? 'No chapter list stored for this book. Open the reader — it will show the book’s own chapters.'
                      : book.format === 'pdf' && book.fileKey ? 'This PDF has no chapters (outline) yet.' : 'Chapter lists are available for EPUB and PDF books.'}
                    {admin && book.format === 'pdf' && book.fileKey && <> <Link to="/edit/$bookId" params={{ bookId: book.slug }} search={{ tab: 'chapters' }}>Add chapters</Link> — they’ll be saved inside the PDF.</>}
                  </p>
                ) : (
                  <ol className="toc-list">
                    {book.toc.map((t, i) => (
                      <li key={`${t.href}-${i}`}>
                        <Link to="/read/$bookId" params={{ bookId: book.slug }} search={{ href: t.href }} className={t.level > 0 ? 'sub' : undefined} style={{ paddingLeft: t.level * 18 }}>
                          <span className="n">{i + 1}</span><span>{t.label}</span>
                        </Link>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
