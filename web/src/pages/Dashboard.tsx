/**
 * The dashboard.
 *
 * Everything on this screen comes from a single request, so the home screen
 * paints in one round trip even on a slow mobile connection.
 */
import { api, type DashboardResponse } from '../api';
import { Link } from '../router';
import { Banner, Card, Chip, EmptyState, SkeletonList, Spinner, Stat, useAsync } from '../components/ui';
import {
  BookIcon,
  FlameIcon,
  HighlighterIcon,
  NotebookIcon,
  PlusIcon,
  QuoteIcon,
  StarIcon,
} from '../components/Icons';
import {
  coverGradient,
  excerpt,
  formatBytes,
  formatDate,
  formatNumber,
  formatProgress,
  normaliseHex,
  pluralise,
  relativeTime,
  todayIso,
  weekdayLong,
} from '../lib/format';

export default function Dashboard() {
  const today = todayIso();
  const state = useAsync<DashboardResponse>(() => api.dashboard(today), [today]);

  if (state.initial && state.loading) {
    return (
      <div className="page">
        <div className="skeleton" style={{ height: 96 }} />
        <SkeletonList rows={2} height={120} />
      </div>
    );
  }

  if (state.error && !state.data) {
    return (
      <div className="page">
        <Banner kind="error">
          {state.error.message}{' '}
          <button type="button" className="btn btn--sm" onClick={state.reload}>
            Retry
          </button>
        </Banner>
      </div>
    );
  }

  const data = state.data;
  if (!data) return <div className="page"><Spinner label="Loading your library…" /></div>;

  const { stats } = data;

  return (
    <div className="page">
      <header className="page__head">
        <div className="page__title">
          <h1>{greeting()}</h1>
          <span className="page__subtitle">
            {weekdayLong(today)}, {formatDate(today)}
          </span>
        </div>
        <div className="row">
          <Link to="/library?new=1" className="btn btn--primary btn--sm">
            <PlusIcon size={16} />
            Add a book
          </Link>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => state.reload()}
            disabled={state.loading}
            aria-label="Refresh"
          >
            {state.loading ? <Spinner /> : 'Refresh'}
          </button>
        </div>
      </header>

      {data.quoteOfTheDay && (
        <Card accent>
          <div className="quote quote--hero">
            <p className="quote__text" style={{ marginBottom: 6 }}>
              “{excerpt(data.quoteOfTheDay.text, 320)}”
            </p>
            <div className="row row--wrap small muted" style={{ gap: 8 }}>
              {data.quoteOfTheDay.author && <span>{data.quoteOfTheDay.author}</span>}
              {data.quoteOfTheDay.source && (
                <span className="faint">· {data.quoteOfTheDay.source}</span>
              )}
            </div>
            {data.quoteOfTheDay.origin && (
              <Link
                to={`/read/${data.quoteOfTheDay.origin.bookId}`}
                className="tiny"
                style={{ display: 'inline-block', marginTop: 8 }}
              >
                From “{excerpt(data.quoteOfTheDay.origin.bookTitle, 40)}”, page{' '}
                {(data.quoteOfTheDay.origin.page ?? 0) + 1}
              </Link>
            )}
          </div>
          <div className="row row--between" style={{ marginTop: 12 }}>
            <span className="card__title">Quote of the day</span>
            <Link to="/quotes" className="small">
              All quotes
            </Link>
          </div>
        </Card>
      )}

      <div className="grid grid--stats">
        <Stat value={formatNumber(stats.books)} label="Books" hint={`${stats.inProgress} in progress`} />
        <Stat value={formatNumber(stats.highlights)} label="Highlights" />
        <Stat value={formatNumber(stats.notes)} label="Notes" />
        <Stat value={formatNumber(stats.quotes)} label="Quotes" />
        <Stat value={formatNumber(stats.streak)} label="Day streak" hint={`${stats.notebookDays} days written`} />
      </div>

      <section className="section">
        <div className="row row--between">
          <h2>Continue reading</h2>
          <Link to="/library" className="small">
            Library
          </Link>
        </div>
        {data.continueReading.length === 0 ? (
          <Card padless>
            <EmptyState
              title="Nothing in progress"
              message="Open a book and Rajgruha will remember exactly where you stopped."
              action={
                <Link to="/library" className="btn btn--primary btn--sm">
                  <BookIcon size={16} />
                  Browse the library
                </Link>
              }
            />
          </Card>
        ) : (
          <div className="grid grid--books">
            {data.continueReading.map(({ book, progress }) => (
              <BookTile
                key={book.id}
                book={book}
                percent={progress?.percent ?? 0}
                caption={progress ? formatProgress(progress.page, progress.pageCount) : undefined}
              />
            ))}
          </div>
        )}
      </section>

      <div className="grid grid--two">
        <Card
          title="Today's notebook"
          action={
            <Link to="/notebook" className="small">
              Open
            </Link>
          }
        >
          {data.notebook.todos.length === 0 && !data.notebook.remarks ? (
            <EmptyState
              title="Nothing written yet today"
              message="Jot down today's todos and remarks — they save as markdown."
              action={
                <Link to="/notebook" className="btn btn--primary btn--sm">
                  <NotebookIcon size={16} />
                  Start writing
                </Link>
              }
            />
          ) : (
            <div className="stack stack--tight">
              {data.notebook.todos.slice(0, 5).map((todo, index) => (
                <label key={`${todo.text}-${index}`} className={`todo${todo.done ? ' todo--done' : ''}`}>
                  <input type="checkbox" checked={todo.done} readOnly tabIndex={-1} />
                  <span className="todo__text">{todo.text}</span>
                </label>
              ))}
              {data.notebook.remarks && (
                <p className="small muted clamp-3" style={{ margin: '6px 0 0' }}>
                  {excerpt(data.notebook.remarks, 220)}
                </p>
              )}
              {data.notebook.updatedAt && (
                <span className="tiny faint">Saved {relativeTime(data.notebook.updatedAt)}</span>
              )}
            </div>
          )}
        </Card>

        <Card
          title="Latest highlights"
          action={
            <Link to="/notes" className="small">
              All notes
            </Link>
          }
        >
          {data.recentlyAnnotated.length === 0 ? (
            <EmptyState
              title="No highlights yet"
              message="Select text while reading and highlight it — it will appear here."
            />
          ) : (
            <div className="stack stack--tight">
              {data.recentlyAnnotated.map((item) => (
                <Link key={`${item.bookId}-${item.id}`} to={`/read/${item.bookId}`} className="list__item" style={{ padding: '10px 0' }}>
                  <span
                    className="highlight-swatch"
                    style={{ background: normaliseHex(item.color), width: 4, height: 34, borderRadius: 2 }}
                  />
                  <span className="grow stack stack--tight">
                    <span className="clamp-2" style={{ fontFamily: 'var(--font-serif)' }}>
                      {excerpt(item.text ?? item.note ?? '(no text)', 150)}
                    </span>
                    <span className="tiny faint">
                      {excerpt(item.bookTitle, 34)} · page {item.page + 1} · {item.kind}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>

      <section className="section">
        <div className="row row--between">
          <h2>Recently added</h2>
          <Link to="/library" className="small">
            See all
          </Link>
        </div>
        <div className="grid grid--books">
          {data.recentlyAdded.map(({ book, progress }) => (
            <BookTile key={book.id} book={book} percent={progress?.percent ?? 0} />
          ))}
        </div>
      </section>

      {data.tags.length > 0 && (
        <Card title="Shelves and tags">
          <div className="chips">
            {data.tags.map((tag) => (
              <Link key={tag.name} to={`/library?tag=${encodeURIComponent(tag.name)}`} className="chip">
                {tag.name}
                <span className="faint">{tag.count}</span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      <Card title="At a glance">
        <div className="row row--wrap" style={{ gap: 18 }}>
          <Glance icon={<FlameIcon size={16} />} label={`${pluralise(stats.notebookDays, 'page')} written`} />
          <Glance icon={<HighlighterIcon size={16} />} label={`${pluralise(stats.annotations, 'annotation')} across ${pluralise(stats.annotatedBooks, 'book')}`} />
          <Glance icon={<QuoteIcon size={16} />} label={`${pluralise(stats.quotes, 'quote')}, ${stats.favorites} favourite book${stats.favorites === 1 ? '' : 's'}`} />
          <Glance icon={<StarIcon size={16} />} label={`${formatNumber(stats.pagesRead)} pages reached`} />
        </div>
      </Card>
    </div>
  );
}

function Glance({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="row small muted" style={{ gap: 6 }}>
      {icon}
      {label}
    </span>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Still up?';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 21) return 'Good evening';
  return 'Good night';
}

/** A book cover rendered from its own colours, so no thumbnail files are needed. */
export function BookTile({
  book,
  percent,
  caption,
}: {
  book: { id: string; title: string; author: string; tags: string[]; favorite: boolean; bytes: number };
  percent: number;
  caption?: string;
}) {
  const cover = coverGradient(book.id);
  return (
    <Link to={`/library/${book.id}`} className="book">
      <div className="book__cover" style={cover}>
        <span>{book.title}</span>
        {book.favorite && (
          <span
            className="badge"
            style={{ position: 'absolute', top: 6, right: 6, background: 'rgb(0 0 0 / 0.35)', color: '#fff' }}
          >
            <StarIcon size={11} filled />
          </span>
        )}
      </div>
      <div className="book__meta">
        <span className="book__title">{book.title}</span>
        <span className="tiny faint truncate">
          {book.author || 'Unknown author'} · {formatBytes(book.bytes)}
        </span>
      </div>
      {percent > 0 && (
        <>
          <div className="book__progress">
            <span style={{ width: `${Math.min(100, percent)}%` }} />
          </div>
          <span className="tiny faint">{caption ?? `${Math.round(percent)}% read`}</span>
        </>
      )}
      {book.tags.length > 0 && (
        <div className="row row--wrap" style={{ gap: 4 }}>
          {book.tags.slice(0, 2).map((tag) => (
            <Chip key={tag}>{tag}</Chip>
          ))}
        </div>
      )}
    </Link>
  );
}
