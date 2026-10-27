/**
 * Notes & Highlights.
 *
 * Every annotation in the library in one place, read from the derived index so
 * the page is a single request regardless of how many books there are. From here
 * a highlight can be promoted into the quote collection, or jumped back to in
 * the reader.
 */
import { useMemo, useState } from 'react';
import { api } from '../api';
import { Link, navigate, useDebounced } from '../router';
import {
  Banner,
  Card,
  Chip,
  EmptyState,
  SkeletonList,
  Spinner,
  useAsync,
  useToast,
} from '../components/ui';
import { SearchIcon, SparkIcon } from '../components/Icons';
import { AnnotationRow } from './BookDetail';
import { PromoteToQuote } from '../components/PromoteToQuote';
import { formatNumber, pluralise } from '../lib/format';
import type { AnnotationIndexItem } from '../../../shared/types';

const KIND_LABELS: Record<string, string> = {
  highlight: 'Highlights',
  underline: 'Underlines',
  strikeout: 'Strikeouts',
  squiggly: 'Squiggly',
  note: 'Sticky notes',
  text: 'Text boxes',
  ink: 'Ink',
  square: 'Shapes',
  circle: 'Shapes',
  stamp: 'Stamps',
  caret: 'Carets',
  freetext: 'Text',
};

interface Props {
  query: URLSearchParams;
}

export default function Notes({ query }: Props) {
  const toast = useToast();
  const bookFilter = query.get('bookId') ?? '';
  const kindFilter = query.get('kind') ?? '';

  const [search, setSearch] = useState('');
  const [textOnly, setTextOnly] = useState(true);
  const [promoting, setPromoting] = useState<AnnotationIndexItem | null>(null);
  const debouncedSearch = useDebounced(search, 250);

  const state = useAsync(
    () =>
      api.notes({
        bookId: bookFilter || undefined,
        kind: kindFilter || undefined,
        q: debouncedSearch || undefined,
        limit: 500,
      }),
    [bookFilter, kindFilter, debouncedSearch],
  );

  const items = state.data?.annotations ?? [];

  // Ink, shapes and stamps are noise for a reading workflow, so they are hidden
  // unless the reader explicitly asks for them.
  const visible = useMemo(
    () => (textOnly ? items.filter((item) => item.text || item.note) : items),
    [items, textOnly],
  );

  const kindCounts = state.data?.byKind ?? {};
  const bookCounts = state.data?.byBook ?? {};
  const bookTitles = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) map.set(item.bookId, item.bookTitle);
    return map;
  }, [items]);

  const hiddenCount = items.length - visible.length;

  return (
    <div className="page">
      <header className="page__head">
        <div className="page__title">
          <h1>Notes &amp; Highlights</h1>
          <span className="page__subtitle">
            {state.data
              ? `${pluralise(state.data.total, 'annotation')} across ${pluralise(Object.keys(bookCounts).length, 'book')}`
              : 'Loading your annotations…'}
          </span>
        </div>
        <Link to="/quotes" className="btn btn--sm">
          Quote collection
        </Link>
      </header>

      <Card>
        <div className="toolbar">
          <span className="search">
            <SearchIcon />
            <input
              className="input"
              type="search"
              placeholder="Search highlight text, notes and books"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search annotations"
            />
          </span>
          <Chip active={textOnly} onClick={() => setTextOnly((value) => !value)} title="Hide drawings and shapes">
            Text only
          </Chip>
          {state.data && state.data.total > 0 && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={state.reload} disabled={state.loading}>
              {state.loading ? <Spinner /> : 'Refresh'}
            </button>
          )}
        </div>

        <div className="chips" style={{ marginTop: 12 }}>
          <Chip
            active={!kindFilter}
            onClick={() => navigate(bookFilter ? `/notes?bookId=${bookFilter}` : '/notes')}
          >
            All kinds
          </Chip>
          {Object.entries(kindCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([kind, count]) => (
              <Chip
                key={kind}
                active={kindFilter === kind}
                onClick={() => {
                  const params = new URLSearchParams();
                  if (bookFilter) params.set('bookId', bookFilter);
                  if (kindFilter !== kind) params.set('kind', kind);
                  const search = params.toString();
                  navigate(`/notes${search ? `?${search}` : ''}`);
                }}
              >
                {KIND_LABELS[kind] ?? kind}
                <span className="faint">{count}</span>
              </Chip>
            ))}
        </div>

        {(bookFilter || Object.keys(bookCounts).length > 1) && (
          <div className="chips" style={{ marginTop: 8 }}>
            {bookFilter && (
              <Chip active onClick={() => navigate(kindFilter ? `/notes?kind=${kindFilter}` : '/notes')}>
                {bookTitles.get(bookFilter) ?? 'This book'} ✕
              </Chip>
            )}
            {!bookFilter &&
              Object.entries(bookCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 8)
                .map(([bookId, count]) => (
                  <Chip key={bookId} onClick={() => navigate(`/notes?bookId=${bookId}`)}>
                    {bookTitles.get(bookId) ?? 'Book'}
                    <span className="faint">{count}</span>
                  </Chip>
                ))}
          </div>
        )}
      </Card>

      {state.error && (
        <Banner kind="error">
          {state.error.message}{' '}
          <button type="button" className="btn btn--sm" onClick={state.reload}>
            Retry
          </button>
        </Banner>
      )}

      {state.initial && state.loading ? (
        <SkeletonList rows={4} height={84} />
      ) : visible.length === 0 ? (
        <Card padless>
          <EmptyState
            title={items.length === 0 ? 'No annotations yet' : 'Nothing matches these filters'}
            message={
              items.length === 0
                ? 'Open a book, select some text and highlight it. Everything you annotate collects here.'
                : hiddenCount > 0
                  ? `${formatNumber(hiddenCount)} drawing annotations are hidden. Turn off “Text only” to see them.`
                  : 'Try clearing the search or the filters.'
            }
            action={
              items.length === 0 ? (
                <Link to="/library" className="btn btn--primary btn--sm">
                  Go to the library
                </Link>
              ) : hiddenCount > 0 ? (
                <button type="button" className="btn btn--sm" onClick={() => setTextOnly(false)}>
                  Show all annotations
                </button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <Card>
          {visible.map((item) => (
            <AnnotationRow
              key={`${item.bookId}-${item.id}`}
              item={item}
              actions={
                <>
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => setPromoting(item)}
                    title="Add this annotation to your quote collection"
                  >
                    <SparkIcon size={14} />
                    {item.quoteId ? 'Edit quote' : 'Add to quotes'}
                  </button>
                  <Link to={`/read/${item.bookId}`} className="btn btn--sm">
                    Open book
                  </Link>
                  <Link to={`/library/${item.bookId}`} className="btn btn--ghost btn--sm">
                    Details
                  </Link>
                </>
              }
            />
          ))}
        </Card>
      )}

      {state.data && state.data.total > visible.length && (
        <p className="tiny faint" style={{ textAlign: 'center' }}>
          Showing {formatNumber(visible.length)} of {formatNumber(state.data.total)} annotations.
        </p>
      )}

      {promoting && (
        <PromoteToQuote
          item={promoting}
          onClose={() => setPromoting(null)}
          onPromoted={() => {
            state.reload();
            toast.push('Find it on the Quotes page', 'info');
          }}
        />
      )}
    </div>
  );
}
