/**
 * A single book: metadata, reading position, its highlights and quotes, and the
 * actions for editing, exporting or deleting it.
 */
import { useState } from 'react';
import { api, downloadJson, errorMessage } from '../api';
import { Link, navigate } from '../router';
import {
  Banner,
  Card,
  Chip,
  EmptyState,
  Field,
  FormModal,
  Modal,
  SkeletonList,
  Spinner,
  Stat,
  useAsync,
  useToast,
} from '../components/ui';
import { BackIcon, BookIcon, EditIcon, QuoteIcon, StarIcon, TrashIcon } from '../components/Icons';
import { coverGradient, excerpt, formatBytes, formatDate, normaliseHex, relativeTime } from '../lib/format';
import type { AnnotationIndexItem } from '../../../shared/types';

export default function BookDetail({ bookId }: { bookId: string }) {
  const toast = useToast();
  const detail = useAsync(() => api.book(bookId), [bookId]);
  const highlights = useAsync(() => api.notes({ bookId, limit: 500 }), [bookId]);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  if (detail.initial && detail.loading) {
    return (
      <div className="page">
        <SkeletonList rows={3} height={120} />
      </div>
    );
  }

  if (detail.error || !detail.data) {
    return (
      <div className="page">
        <Banner kind="error">{detail.error?.message ?? 'That book could not be loaded.'}</Banner>
        <Link to="/library" className="btn btn--sm">
          Back to the library
        </Link>
      </div>
    );
  }

  const { book, progress, annotationCount, fileUrl } = detail.data;
  const cover = coverGradient(book.id);
  const items = highlights.data?.annotations ?? [];

  async function toggleFavorite() {
    try {
      await api.updateBook(book.id, { favorite: !book.favorite });
      detail.reload();
    } catch (error) {
      toast.error(error);
    }
  }

  async function toggleFinished() {
    try {
      await api.updateBook(book.id, { finished: !book.finishedAt });
      toast.push(book.finishedAt ? 'Marked as still reading' : 'Marked as finished', 'success');
      detail.reload();
    } catch (error) {
      toast.error(error);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.deleteBook(book.id);
      toast.push(`Deleted “${book.title}”`, 'success');
      navigate('/library');
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  function exportNotes() {
    downloadJson(`rajgruha-${book.id}-notes.json`, {
      format: 'rajgruha-book-notes',
      version: 1,
      exportedAt: new Date().toISOString(),
      book,
      annotations: items,
    });
    toast.push('Notes exported as JSON', 'success');
  }

  return (
    <div className="page">
      <div className="row">
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => navigate('/library')}>
          <BackIcon size={16} />
          Library
        </button>
      </div>

      <Card>
        <div className="row row--wrap" style={{ gap: 18, alignItems: 'flex-start' }}>
          <div
            style={{ ...cover, width: 108, height: 144, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12, textAlign: 'center', fontFamily: 'var(--font-serif)', fontWeight: 600 }}
            aria-hidden="true"
          >
            <span style={{ display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {book.title}
            </span>
          </div>

          <div className="grow stack">
            <div className="stack stack--tight">
              <h1>{book.title}</h1>
              <span className="muted small">
                {book.author || 'Unknown author'}
                {book.pageCount ? ` · ${book.pageCount} pages` : ''}
                {` · ${formatBytes(book.bytes)}`}
              </span>
              <span className="tiny faint">
                Added {formatDate(book.addedAt)}
                {book.lastOpenedAt ? ` · last opened ${relativeTime(book.lastOpenedAt)}` : ''}
              </span>
            </div>

            {book.description && <p className="small muted">{book.description}</p>}

            {(book.tags.length > 0 || book.shelf) && (
              <div className="row row--wrap" style={{ gap: 6 }}>
                {book.shelf && <Chip>{book.shelf}</Chip>}
                {book.tags.map((tag) => (
                  <Chip key={tag}>{tag}</Chip>
                ))}
              </div>
            )}

            {book.finishedAt && <span className="badge badge--success">Finished {formatDate(book.finishedAt)}</span>}

            <div className="row row--wrap">
              <Link to={`/read/${book.id}`} className="btn btn--primary">
                <BookIcon size={16} />
                {progress && progress.percent > 0 && progress.percent < 98 ? 'Continue reading' : 'Read'}
              </Link>
              <a className="btn" href={fileUrl} target="_blank" rel="noreferrer">
                Open PDF
              </a>
              <button type="button" className="btn btn--icon" onClick={toggleFavorite} aria-label="Toggle favourite">
                <StarIcon filled={book.favorite} />
              </button>
              <button type="button" className="btn btn--sm" onClick={() => setEditing(true)}>
                <EditIcon size={15} />
                Edit
              </button>
              <button type="button" className="btn btn--sm" onClick={toggleFinished}>
                {book.finishedAt ? 'Still reading' : 'Mark finished'}
              </button>
              <button type="button" className="btn btn--danger btn--sm" onClick={() => setConfirmDelete(true)}>
                <TrashIcon size={15} />
                Delete
              </button>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid--stats">
        <Stat
          value={progress ? `${Math.round(progress.percent)}%` : '—'}
          label="Read"
          hint={progress ? `page ${progress.page + 1}` : 'not started'}
        />
        <Stat value={annotationCount} label="Annotations" hint="saved in annotations.json" />
        <Stat value={items.length} label="Indexed highlights" />
        <Stat value={items.filter((item) => item.quoteId).length} label="In quotes" />
      </div>

      <Card
        title="Highlights and notes"
        action={
          <div className="row">
            <button type="button" className="btn btn--ghost btn--sm" onClick={exportNotes} disabled={items.length === 0}>
              Export
            </button>
            <Link to={`/notes?bookId=${book.id}`} className="small">
              Filter
            </Link>
          </div>
        }
      >
        {highlights.initial && highlights.loading ? (
          <SkeletonList rows={2} height={64} />
        ) : items.length === 0 ? (
          <EmptyState
            title="No annotations yet"
            message="Highlights, underlines and sticky notes you make while reading will be listed here."
            action={
              <Link to={`/read/${book.id}`} className="btn btn--sm">
                Start reading
              </Link>
            }
          />
        ) : (
          <div className="stack">
            {items.map((item) => (
              <AnnotationRow key={item.id} item={item} />
            ))}
          </div>
        )}
      </Card>

      {editing && (
        <EditBookModal
          book={book}
          onClose={() => setEditing(false)}
          onSaved={() => {
            detail.reload();
            setEditing(false);
          }}
        />
      )}

      {confirmDelete && (
        <Modal
          title="Delete this book?"
          onClose={() => setConfirmDelete(false)}
          submitLabel="Delete for good"
          danger
          busy={busy}
          onSubmit={remove}
        >
          <p className="small muted">
            This removes the PDF, its annotations, its reading position and its highlights from your
            notes. It cannot be undone.
          </p>
          {items.length > 0 && (
            <Banner kind="info">
              {items.length} highlight{items.length === 1 ? '' : 's'} will also be removed.
            </Banner>
          )}
        </Modal>
      )}
    </div>
  );
}

export function AnnotationRow({ item, actions }: { item: AnnotationIndexItem; actions?: React.ReactNode }) {
  return (
    <div className="note-row">
      <span className="note-row__bar" style={{ background: normaliseHex(item.color) }} />
      <div className="note-row__body">
        {item.text && <p className="note-row__text" style={{ margin: 0 }}>{item.text}</p>}
        {item.note && (
          <p className="small muted" style={{ margin: 0 }}>
            {item.note}
          </p>
        )}
        {!item.text && !item.note && <p className="small faint" style={{ margin: 0 }}>({item.kind} annotation with no text)</p>}

        <div className="row row--wrap tiny faint" style={{ gap: 8 }}>
          <span className="badge badge--muted">{item.kind}</span>
          <span>page {item.page + 1}</span>
          {item.bookTitle && <span className="truncate">· {excerpt(item.bookTitle, 30)}</span>}
          {item.updatedAt && <span>· {relativeTime(item.updatedAt)}</span>}
          {item.quoteId && (
            <span className="badge">
              <QuoteIcon size={11} />
              in quotes
            </span>
          )}
        </div>

        {actions && <div className="row row--wrap" style={{ gap: 6 }}>{actions}</div>}
      </div>
    </div>
  );
}

function EditBookModal({
  book,
  onClose,
  onSaved,
}: {
  book: { id: string; title: string; author: string; description: string; tags: string[]; shelf: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author);
  const [description, setDescription] = useState(book.description);
  const [tags, setTags] = useState(book.tags.join(', '));
  const [shelf, setShelf] = useState(book.shelf);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.updateBook(book.id, {
        title,
        author,
        description,
        shelf,
        tags: tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      });
      toast.push('Book updated', 'success');
      onSaved();
    } catch (thrown) {
      setError(errorMessage(thrown));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormModal title="Edit book" onClose={onClose} onSubmit={submit} submitLabel="Save changes">
      {error && <Banner kind="error">{error}</Banner>}
      <Field label="Title">
        <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} />
      </Field>
      <Field label="Author">
        <input className="input" value={author} onChange={(event) => setAuthor(event.target.value)} maxLength={160} />
      </Field>
      <Field label="Description">
        <textarea
          className="textarea"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={2000}
          style={{ minHeight: 80, fontFamily: 'var(--font-ui)' }}
        />
      </Field>
      <Field label="Tags" hint="comma separated">
        <input className="input" value={tags} onChange={(event) => setTags(event.target.value)} />
      </Field>
      <Field label="Shelf">
        <input className="input" value={shelf} onChange={(event) => setShelf(event.target.value)} maxLength={60} />
      </Field>
      {busy && <Spinner />}
    </FormModal>
  );
}
