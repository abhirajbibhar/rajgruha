/**
 * The library: search, filter, sort, and upload.
 *
 * Filtering happens on the client because a personal library fits in one
 * response, which makes search feel instant on a phone with no round trips.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage } from '../api';
import { Link, navigate } from '../router';
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
import { BookIcon, SearchIcon, StarIcon, UploadIcon } from '../components/Icons';
import { BookTile } from './Dashboard';
import { coverGradient, formatBytes, formatDate, normaliseHex, relativeTime } from '../lib/format';
import type { BookMeta, UserSettings } from '../../../shared/types';

interface Props {
  query: URLSearchParams;
}

type View = UserSettings['library']['view'];
type SortBy = UserSettings['library']['sortBy'];

export default function Library({ query }: Props) {
  const toast = useToast();
  const tag = query.get('tag') ?? '';
  const wantsUpload = query.get('new') === '1';

  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('recent');
  const [view, setView] = useState<View>('grid');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(wantsUpload);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const booksState = useAsync(() => api.library({ sort: 'recent' }), []);
  const progressState = useAsync(() => api.dashboard(), []);

  // The stored preferences decide the initial view; after that the chips win.
  useEffect(() => {
    if (settingsLoaded) return;
    api
      .settings()
      .then(({ settings }) => {
        setSortBy(settings.library.sortBy);
        setView(settings.library.view);
      })
      .catch(() => {
        /* Defaults are fine. */
      })
      .finally(() => setSettingsLoaded(true));
  }, [settingsLoaded]);

  const progressByBook = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of [
      ...(progressState.data?.continueReading ?? []),
      ...(progressState.data?.startedRecently ?? []),
    ]) {
      if (entry.progress) map.set(entry.book.id, entry.progress.percent);
    }
    return map;
  }, [progressState.data]);

  const books = booksState.data?.books ?? [];

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = books.filter((book) => {
      if (favoritesOnly && !book.favorite) return false;
      if (tag && !book.tags.includes(tag) && book.shelf !== tag) return false;
      if (!needle) return true;
      return `${book.title} ${book.author} ${book.tags.join(' ')} ${book.shelf} ${book.description}`
        .toLowerCase()
        .includes(needle);
    });

    const sorted = [...list];
    switch (sortBy) {
      case 'title':
        sorted.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'author':
        sorted.sort((a, b) => a.author.localeCompare(b.author) || a.title.localeCompare(b.title));
        break;
      case 'added':
        sorted.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
        break;
      default:
        sorted.sort(
          (a, b) =>
            new Date(b.lastOpenedAt ?? b.addedAt).getTime() - new Date(a.lastOpenedAt ?? a.addedAt).getTime(),
        );
    }
    return sorted;
  }, [books, favoritesOnly, search, sortBy, tag]);

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const book of books) {
      for (const value of [...book.tags, book.shelf].filter(Boolean)) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [books]);

  return (
    <div className="page">
      <header className="page__head">
        <div className="page__title">
          <h1>Library</h1>
          <span className="page__subtitle">
            {books.length === 0
              ? 'Nothing uploaded yet'
              : `${books.length} book${books.length === 1 ? '' : 's'}${tag ? ` · tagged ${tag}` : ''}`}
          </span>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => setUploadOpen(true)}>
          <UploadIcon size={16} />
          Upload PDF
        </button>
      </header>

      <Card>
        <div className="toolbar">
          <span className="search search--compact">
            <SearchIcon />
            <input
              className="input"
              type="search"
              placeholder="Search titles, authors, tags"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search the library"
            />
          </span>

          <div className="tabs" role="tablist" aria-label="Sort">
            {(
              [
                ['recent', 'Recent'],
                ['title', 'Title'],
                ['author', 'Author'],
                ['added', 'Added'],
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

          <div className="row" style={{ gap: 6 }}>
            <Chip active={view === 'grid'} onClick={() => setView('grid')}>
              Grid
            </Chip>
            <Chip active={view === 'list'} onClick={() => setView('list')}>
              List
            </Chip>
            <Chip active={favoritesOnly} onClick={() => setFavoritesOnly((value) => !value)}>
              <StarIcon size={12} filled={favoritesOnly} />
              Favourites
            </Chip>
          </div>
        </div>

        {allTags.length > 0 && (
          <div className="chips" style={{ marginTop: 12 }}>
            {tag && (
              <Chip active onClick={() => navigate('/library')} title="Clear the tag filter">
                {tag} ✕
              </Chip>
            )}
            {allTags.slice(0, 14).map(([name, count]) => (
              <Chip
                key={name}
                active={tag === name}
                onClick={() => navigate(tag === name ? '/library' : `/library?tag=${encodeURIComponent(name)}`)}
              >
                {name}
                <span className="faint">{count}</span>
              </Chip>
            ))}
          </div>
        )}
      </Card>

      {booksState.error && (
        <Banner kind="error">
          {booksState.error.message}{' '}
          <button type="button" className="btn btn--sm" onClick={booksState.reload}>
            Retry
          </button>
        </Banner>
      )}

      {booksState.initial && booksState.loading ? (
        <SkeletonList rows={3} height={210} />
      ) : filtered.length === 0 ? (
        <Card padless>
          {books.length === 0 ? (
            <EmptyState
              title="Your library is empty"
              message="Upload a PDF and Rajgruha will keep it, your reading position, and every highlight you make."
              action={
                <button type="button" className="btn btn--primary" onClick={() => setUploadOpen(true)}>
                  <UploadIcon size={16} />
                  Upload a PDF
                </button>
              }
            />
          ) : (
            <EmptyState
              title="No books match"
              message="Try a different search, or clear the filters."
              action={
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => {
                    setSearch('');
                    setFavoritesOnly(false);
                    navigate('/library');
                  }}
                >
                  Clear filters
                </button>
              }
            />
          )}
        </Card>
      ) : view === 'grid' ? (
        <div className="grid grid--books">
          {filtered.map((book) => (
            <BookTile key={book.id} book={book} percent={progressByBook.get(book.id) ?? 0} />
          ))}
        </div>
      ) : (
        <Card padless>
          <div className="list">
            {filtered.map((book) => (
              <BookRow key={book.id} book={book} percent={progressByBook.get(book.id) ?? 0} />
            ))}
          </div>
        </Card>
      )}

      {uploadOpen && (
        <UploadModal
          onClose={() => {
            setUploadOpen(false);
            if (wantsUpload) navigate('/library');
          }}
          onUploaded={(book) => {
            toast.push(`“${book.title}” added to your library`, 'success');
            booksState.reload();
          }}
          onError={(error) => toast.push(errorMessage(error), 'error')}
        />
      )}
    </div>
  );
}

function BookRow({ book, percent }: { book: BookMeta; percent: number }) {
  const cover = coverGradient(book.id);
  return (
    <Link to={`/library/${book.id}`} className="list__item">
      <span
        style={{ ...cover, width: 34, height: 44, borderRadius: 6, flex: 'none' }}
        aria-hidden="true"
      />
      <span className="grow stack stack--tight">
        <span className="row" style={{ gap: 6 }}>
          <strong className="truncate">{book.title}</strong>
          {book.favorite && <StarIcon size={13} filled />}
        </span>
        <span className="tiny faint truncate">
          {book.author || 'Unknown author'} · {formatBytes(book.bytes)}
          {book.pageCount ? ` · ${book.pageCount} pages` : ''}
          {percent > 0 ? ` · ${Math.round(percent)}% read` : ''}
        </span>
      </span>
      <span className="tiny faint nowrap">{relativeTime(book.lastOpenedAt ?? book.addedAt)}</span>
    </Link>
  );
}

function UploadModal({
  onClose,
  onUploaded,
  onError,
}: {
  onClose: () => void;
  onUploaded: (book: BookMeta) => void;
  onError: (error: unknown) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [tags, setTags] = useState('');
  const [shelf, setShelf] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function submit() {
    if (!file) {
      setError('Choose a PDF first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { book } = await api.uploadBook(file, { title, author, tags, shelf });
      onUploaded(book);
      onClose();
    } catch (thrown) {
      setError(errorMessage(thrown));
      onError(thrown);
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormModal title="Upload a PDF" onClose={onClose} onSubmit={submit} submitLabel="Add to library">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(event) => {
          const chosen = event.target.files?.[0] ?? null;
          setFile(chosen);
          if (chosen && !title) {
            setTitle(chosen.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '));
          }
        }}
      />

      <button
        type="button"
        className="btn btn--block"
        onClick={() => inputRef.current?.click()}
        style={{ minHeight: 92, flexDirection: 'column', gap: 6 }}
      >
        <UploadIcon size={22} />
        {file ? (
          <>
            <strong>{file.name}</strong>
            <span className="tiny faint">{formatBytes(file.size)}</span>
          </>
        ) : (
          <span className="muted">Choose a PDF (up to 50 MB)</span>
        )}
      </button>

      {error && <Banner kind="error">{error}</Banner>}

      <Field label="Title" hint="optional, defaults to the file name">
        <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} />
      </Field>

      <Field label="Author" hint="optional">
        <input className="input" value={author} onChange={(event) => setAuthor(event.target.value)} maxLength={160} />
      </Field>

      <Field label="Tags" hint="comma separated">
        <input
          className="input"
          value={tags}
          onChange={(event) => setTags(event.target.value)}
          placeholder="philosophy, to-reread"
          maxLength={200}
        />
      </Field>

      <Field label="Shelf" hint="optional, one shelf per book">
        <input className="input" value={shelf} onChange={(event) => setShelf(event.target.value)} maxLength={60} />
      </Field>

      {busy && <Spinner label="Uploading and indexing…" />}
    </FormModal>
  );
}
