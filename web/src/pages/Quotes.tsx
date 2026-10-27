/**
 * The quote collection.
 *
 * Quotes that came from a PDF carry an origin, so each one can offer a link
 * straight back to the page it was found on.
 */
import { useMemo, useState } from 'react';
import { api, downloadJson } from '../api';
import { Link, navigate, useDebounced } from '../router';
import {
  Banner,
  Card,
  Chip,
  EmptyState,
  Field,
  FormModal,
  SkeletonList,
  Spinner,
  useAsync,
  useToast,
} from '../components/ui';
import { EditIcon, SearchIcon, SparkIcon, StarIcon, TrashIcon } from '../components/Icons';
import { excerpt, formatDate, pluralise, relativeTime } from '../lib/format';
import type { Quote } from '../../../shared/types';

interface Props {
  query: URLSearchParams;
}

export default function Quotes({ query }: Props) {
  const toast = useToast();
  const tag = query.get('tag') ?? '';

  const [search, setSearch] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sortBy, setSortBy] = useState('recent');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Quote | null>(null);
  const [deleting, setDeleting] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const debouncedSearch = useDebounced(search, 250);

  const state = useAsync(
    () => api.quotes({ tag: tag || undefined, q: debouncedSearch || undefined, favorite: favoritesOnly, sort: sortBy }),
    [tag, debouncedSearch, favoritesOnly, sortBy],
  );

  const quotes = state.data?.quotes ?? [];
  const facets = state.data?.facets;

  const withOrigin = useMemo(() => quotes.filter((quote) => quote.origin).length, [quotes]);

  async function toggleFavorite(quote: Quote) {
    try {
      await api.updateQuote(quote.id, { favorite: !quote.favorite });
      state.reload();
    } catch (error) {
      toast.error(error);
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.deleteQuote(deleting.id);
      toast.push('Quote removed', 'success');
      state.reload();
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  }

  return (
    <div className="page">
      <header className="page__head">
        <div className="page__title">
          <h1>Quotes</h1>
          <span className="page__subtitle">
            {state.data
              ? `${pluralise(state.data.total, 'quote')}${withOrigin ? ` · ${withOrigin} from your books` : ''}`
              : 'Loading your collection…'}
          </span>
        </div>
        <div className="row">
          <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
            <SparkIcon size={16} />
            New quote
          </button>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => {
              downloadJson('rajgruha-quotes.json', state.data ?? {});
              toast.push('Quotes exported as JSON', 'success');
            }}
            disabled={quotes.length === 0}
          >
            Export
          </button>
        </div>
      </header>

      <Card>
        <div className="toolbar">
          <span className="search">
            <SearchIcon />
            <input
              className="input"
              type="search"
              placeholder="Search quotes, authors and sources"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search quotes"
            />
          </span>

          <div className="tabs" role="tablist" aria-label="Sort">
            {(
              [
                ['recent', 'Recent'],
                ['oldest', 'Oldest'],
                ['author', 'Author'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                className="tab"
                aria-selected={sortBy === value}
                onClick={() => setSortBy(value)}
              >
                {label}
              </button>
            ))}
          </div>

          <Chip active={favoritesOnly} onClick={() => setFavoritesOnly((value) => !value)}>
            <StarIcon size={12} filled={favoritesOnly} />
            Favourites
          </Chip>
        </div>

        {facets && facets.tags.length > 0 && (
          <div className="chips" style={{ marginTop: 12 }}>
            {tag && (
              <Chip active onClick={() => navigate('/quotes')}>
                {tag} ✕
              </Chip>
            )}
            {facets.tags.slice(0, 16).map((value) => (
              <Chip
                key={value}
                active={tag === value}
                onClick={() => navigate(tag === value ? '/quotes' : `/quotes?tag=${encodeURIComponent(value)}`)}
              >
                {value}
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
        <SkeletonList rows={3} height={120} />
      ) : quotes.length === 0 ? (
        <Card padless>
          <EmptyState
            title={tag || search || favoritesOnly ? 'No quotes match' : 'Your collection is empty'}
            message={
              tag || search || favoritesOnly
                ? 'Try clearing the filters.'
                : 'Add one here, or highlight something in a book and use “Add to quotes”.'
            }
            action={
              tag || search || favoritesOnly ? (
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => {
                    setSearch('');
                    setFavoritesOnly(false);
                    navigate('/quotes');
                  }}
                >
                  Clear filters
                </button>
              ) : (
                <div className="row">
                  <button type="button" className="btn btn--primary btn--sm" onClick={() => setCreating(true)}>
                    Write a quote
                  </button>
                  <Link to="/notes" className="btn btn--sm">
                    Browse highlights
                  </Link>
                </div>
              )
            }
          />
        </Card>
      ) : (
        <div className="stack">
          {quotes.map((quote) => (
            <Card key={quote.id}>
              <div className="quote">
                <p className="quote__text" style={{ marginBottom: 8 }}>
                  “{quote.text}”
                </p>
                {(quote.author || quote.source) && (
                  <p className="small muted" style={{ margin: 0 }}>
                    {quote.author ? `— ${quote.author}` : ''}
                    {quote.author && quote.source ? ' · ' : ''}
                    {quote.source ? <em>{quote.source}</em> : ''}
                  </p>
                )}
                {quote.note && (
                  <p className="small" style={{ margin: '8px 0 0', color: 'var(--text-muted)' }}>
                    {quote.note}
                  </p>
                )}
              </div>

              <div className="row row--wrap tiny faint" style={{ gap: 8, marginTop: 10 }}>
                <span>Added {formatDate(quote.createdAt)}</span>
                {quote.updatedAt !== quote.createdAt && <span>· edited {relativeTime(quote.updatedAt)}</span>}
                {quote.origin && (
                  <Link to={`/read/${quote.origin.bookId}`} className="badge">
                    {excerpt(quote.origin.bookTitle, 26)} · page {quote.origin.page !== null ? quote.origin.page + 1 : '?'}
                  </Link>
                )}
                {quote.tags.map((value) => (
                  <Chip
                    key={value}
                    onClick={() => navigate(`/quotes?tag=${encodeURIComponent(value)}`)}
                  >
                    {value}
                  </Chip>
                ))}
              </div>

              <div className="row row--wrap" style={{ gap: 6, marginTop: 10 }}>
                <button
                  type="button"
                  className="btn btn--icon btn--sm"
                  onClick={() => toggleFavorite(quote)}
                  aria-label={quote.favorite ? 'Remove from favourites' : 'Add to favourites'}
                >
                  <StarIcon size={15} filled={quote.favorite} />
                </button>
                <button type="button" className="btn btn--sm" onClick={() => setEditing(quote)}>
                  <EditIcon size={14} />
                  Edit
                </button>
                {quote.origin && (
                  <Link to={`/read/${quote.origin.bookId}`} className="btn btn--sm">
                    Open book
                  </Link>
                )}
                <button type="button" className="btn btn--danger btn--sm" onClick={() => setDeleting(quote)}>
                  <TrashIcon size={14} />
                  Delete
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {creating && (
        <QuoteModal
          onClose={() => setCreating(false)}
          onSaved={() => {
            toast.push('Quote added', 'success');
            state.reload();
            setCreating(false);
          }}
        />
      )}

      {editing && (
        <QuoteModal
          quote={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            toast.push('Quote updated', 'success');
            state.reload();
            setEditing(null);
          }}
        />
      )}

      {deleting && (
        <FormModal
          title="Delete this quote?"
          onClose={() => setDeleting(null)}
          onSubmit={remove}
          submitLabel="Delete"
          danger
        >
          <p className="small muted">“{excerpt(deleting.text, 160)}”</p>
          <p className="tiny faint">This only removes the quote. Your annotations stay in the book.</p>
          {busy && <Spinner />}
        </FormModal>
      )}
    </div>
  );
}

/** Create or edit a quote. */
function QuoteModal({
  quote,
  onClose,
  onSaved,
}: {
  quote?: Quote;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [text, setText] = useState(quote?.text ?? '');
  const [note, setNote] = useState(quote?.note ?? '');
  const [author, setAuthor] = useState(quote?.author ?? '');
  const [source, setSource] = useState(quote?.source ?? '');
  const [tags, setTags] = useState(quote?.tags.join(', ') ?? '');
  const [favorite, setFavorite] = useState(quote?.favorite ?? false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!text.trim()) {
      setError('A quote needs some text.');
      return;
    }
    const payload = {
      text: text.trim(),
      note: note.trim(),
      author: author.trim(),
      source: source.trim(),
      tags: tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      favorite,
    };
    try {
      if (quote) await api.updateQuote(quote.id, payload);
      else await api.createQuote(payload);
      onSaved();
    } catch (thrown) {
      toast.error(thrown);
      setError(thrown instanceof Error ? thrown.message : 'Could not save that quote.');
    }
  }

  return (
    <FormModal
      title={quote ? 'Edit quote' : 'New quote'}
      onClose={onClose}
      onSubmit={submit}
      submitLabel={quote ? 'Save changes' : 'Add quote'}
    >
      {error && <Banner kind="error">{error}</Banner>}

      <Field label="Quote">
        <textarea
          className="textarea"
          value={text}
          onChange={(event) => setText(event.target.value)}
          style={{ fontFamily: 'var(--font-serif)', minHeight: 120 }}
          maxLength={4000}
          autoFocus={!quote}
        />
      </Field>

      <Field label="Your note" hint="optional">
        <textarea
          className="textarea"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          style={{ fontFamily: 'var(--font-ui)', minHeight: 70 }}
          maxLength={4000}
        />
      </Field>

      <Field label="Author" hint="optional">
        <input className="input" value={author} onChange={(event) => setAuthor(event.target.value)} maxLength={160} />
      </Field>

      <Field label="Source" hint="book, talk, article…">
        <input className="input" value={source} onChange={(event) => setSource(event.target.value)} maxLength={300} />
      </Field>

      <Field label="Tags" hint="comma separated">
        <input className="input" value={tags} onChange={(event) => setTags(event.target.value)} />
      </Field>

      <Chip active={favorite} onClick={() => setFavorite((value) => !value)}>
        <StarIcon size={12} filled={favorite} />
        Favourite
      </Chip>
    </FormModal>
  );
}
