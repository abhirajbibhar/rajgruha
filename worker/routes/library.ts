/**
 * The library: uploading PDFs, reading their bytes back with range support, and
 * tracking reading position.
 *
 * Per-book `meta.json` is the source of truth; `index/library.json` is a derived
 * listing so the library page is one read instead of one read per book. If the
 * cache ever drifts, POST /api/library/reindex rebuilds it from the metadata.
 */
import { Hono } from 'hono';
import { currentUser, requireUser, signFileToken, verifyFileToken } from '../auth';
import type { AppEnv } from '../env';
import { asBool, asInt, asString, asStringArray, badRequest, notFound, readJson, tooLarge } from '../lib/http';
import { keys, newId } from '../lib/keys';
import { buildIndexItems, mergeAnnotations } from '../lib/annotations';
import {
  deleteBookObjects,
  getAnnotationsIndex,
  getBookAnnotations,
  getBookMeta,
  getLibraryIndex,
  getProgress,
  putAnnotationsIndex,
  putBookAnnotations,
  putBookMeta,
  putLibraryIndex,
  putProgress,
  rebuildLibraryIndex,
  updateAnnotationsIndexForBook,
} from '../lib/repo';
import type { AnnotationTransferItem, BookMeta, BookProgress } from '../lib/types';

/** Loose type for the incoming array, validated before use. */
type AnnotationTransferItemInput = Partial<AnnotationTransferItem> & { annotation?: Record<string, unknown> };

export const libraryRoutes = new Hono<AppEnv>();

const PDF_MAGIC = '%PDF-';
const DEFAULT_MAX_UPLOAD = 50 * 1024 * 1024;

function maxUploadBytes(env: AppEnv['Bindings']): number {
  const parsed = Number(env.UPLOAD_MAX_BYTES);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_UPLOAD;
}

/** Cheap sanity check that the upload really is a PDF. */
async function looksLikePdf(file: File): Promise<boolean> {
  const header = new Uint8Array(await file.slice(0, PDF_MAGIC.length).arrayBuffer());
  return new TextDecoder().decode(header) === PDF_MAGIC;
}

function titleFromFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  return base.length ? base.slice(0, 200) : 'Untitled';
}

/** Sorts the library listing the same way on every device. */
function sortBooks(books: BookMeta[], sortBy: string): BookMeta[] {
  const copy = [...books];
  const byRecent = (a: BookMeta, b: BookMeta) =>
    new Date(b.lastOpenedAt ?? b.addedAt).getTime() - new Date(a.lastOpenedAt ?? a.addedAt).getTime();
  switch (sortBy) {
    case 'title':
      copy.sort((a, b) => a.title.localeCompare(b.title));
      break;
    case 'author':
      copy.sort((a, b) => a.author.localeCompare(b.author) || a.title.localeCompare(b.title));
      break;
    case 'added':
      copy.sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime());
      break;
    default:
      copy.sort(byRecent);
  }
  return copy;
}

/** GET /api/library */
libraryRoutes.get('/', requireUser(), async (c) => {
  const store = c.get('store');
  const userId = c.get('user').id;
  const index = await getLibraryIndex(store, userId);

  let books = index.books;
  // Self-heal: an empty cache over a non-empty bucket is a reindex, not an empty library.
  if (books.length === 0) {
    const objects = await store.list({ prefix: keys.libraryPrefix(userId), limit: 1 });
    if (objects.keys.length > 0) books = await rebuildLibraryIndex(store, userId, c.get('now')());
  }

  const sortBy = c.req.query('sort') ?? 'recent';
  return c.json({ books: sortBooks(books, sortBy), updatedAt: index.updatedAt });
});

/** POST /api/library/reindex - rebuilds the derived indexes from source objects. */
libraryRoutes.post('/reindex', requireUser(), async (c) => {
  const store = c.get('store');
  const userId = c.get('user').id;
  const now = c.get('now')();
  const books = await rebuildLibraryIndex(store, userId, now);

  // Rebuild the annotations index from each book's own annotation file.
  const index = { version: 1 as const, updatedAt: now.toISOString(), books: {} as Record<string, never> };
  for (const book of books) {
    const stored = await getBookAnnotations(store, userId, book.id, now);
    if (stored.items.length === 0) continue;
    (index.books as Record<string, unknown>)[book.id] = {
      bookTitle: book.title,
      count: stored.items.length,
      updatedAt: stored.updatedAt,
      items: buildIndexItems(stored.items, book.id, book.title),
    };
  }
  await putAnnotationsIndex(store, userId, index as never);

  return c.json({ books: books.length, annotatedBooks: Object.keys(index.books).length });
});

/** POST /api/library - multipart upload of one PDF. */
libraryRoutes.post('/', requireUser(), async (c) => {
  const store = c.get('store');
  const userId = c.get('user').id;
  const now = c.get('now')();
  const limit = maxUploadBytes(c.env);

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    throw badRequest('Expected a multipart/form-data upload with a "file" field');
  }

  const file = form.get('file');
  if (!(file instanceof File)) throw badRequest('Expected a "file" field containing the PDF');
  if (file.size === 0) throw badRequest('The uploaded file is empty');
  if (file.size > limit) throw tooLarge(`PDFs must be at most ${Math.round(limit / 1024 / 1024)} MB`);
  if (!(await looksLikePdf(file))) throw badRequest('That file does not look like a PDF');

  const bookId = newId();
  const meta: BookMeta = {
    id: bookId,
    title: asString(form.get('title'), 'title', { max: 200, required: false }) || titleFromFilename(file.name),
    author: asString(form.get('author'), 'author', { max: 160, required: false }),
    description: asString(form.get('description'), 'description', { max: 2000, required: false }),
    tags: asStringArray(splitCsv(form.get('tags')), 'tags'),
    shelf: asString(form.get('shelf'), 'shelf', { max: 60, required: false }),
    favorite: false,
    filename: file.name || 'document.pdf',
    bytes: file.size,
    // Filled in the first time the viewer opens the book, which is the only
    // place that actually knows the page count.
    pageCount: null,
    addedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    lastOpenedAt: null,
    finishedAt: null,
  };

  await store.put(keys.bookFile(userId, bookId), await file.arrayBuffer(), {
    contentType: 'application/pdf',
    contentDisposition: `inline; filename="${meta.filename.replace(/"/g, '')}"`,
    cacheControl: 'private, max-age=600',
  });
  await putBookMeta(store, userId, meta);

  const index = await getLibraryIndex(store, userId);
  await putLibraryIndex(store, userId, [meta, ...index.books.filter((book) => book.id !== bookId)], now);

  return c.json({ book: meta }, 201);
});

/** GET /api/library/:bookId */
libraryRoutes.get('/:bookId', requireUser(), async (c) => {
  const store = c.get('store');
  const userId = c.get('user').id;
  const bookId = c.req.param('bookId');
  const now = c.get('now')();

  const [meta, progress, annotations, annotationsIndex] = await Promise.all([
    getBookMeta(store, userId, bookId),
    getProgress(store, userId, bookId),
    getBookAnnotations(store, userId, bookId, now),
    getAnnotationsIndex(store, userId),
  ]);
  if (!meta) throw notFound('That book is not in your library');

  return c.json({
    book: meta,
    progress,
    annotationCount: annotations.items.length,
    annotationRevision: annotations.revision,
    highlights: annotationsIndex.books[bookId]?.items.length ?? 0,
    // A signed, book-scoped URL so the PDF engine's own range requests work
    // regardless of how its internal fetcher handles cookies.
    fileUrl: `/api/library/${bookId}/file?t=${await signFileToken(userId, bookId, c.env.SESSION_SECRET, now)}`,
  });
});

/** PATCH /api/library/:bookId */
libraryRoutes.patch('/:bookId', requireUser(), async (c) => {
  const store = c.get('store');
  const userId = c.get('user').id;
  const bookId = c.req.param('bookId');
  const now = c.get('now')();
  const body = await readJson(c.req.raw);

  const meta = await getBookMeta(store, userId, bookId);
  if (!meta) throw notFound('That book is not in your library');

  if (body.title !== undefined) meta.title = asString(body.title, 'title', { max: 200 });
  if (body.author !== undefined) meta.author = asString(body.author, 'author', { max: 160, required: false });
  if (body.description !== undefined) meta.description = asString(body.description, 'description', { max: 2000, required: false });
  if (body.tags !== undefined) meta.tags = asStringArray(body.tags, 'tags');
  if (body.shelf !== undefined) meta.shelf = asString(body.shelf, 'shelf', { max: 60, required: false });
  if (body.favorite !== undefined) meta.favorite = asBool(body.favorite, 'favorite');
  if (body.pageCount !== undefined) {
    meta.pageCount = asInt(body.pageCount, 'pageCount', { min: 1, max: 100_000 });
  }
  if (body.finished !== undefined) {
    meta.finishedAt = asBool(body.finished, 'finished') ? (meta.finishedAt ?? now.toISOString()) : null;
  }
  meta.updatedAt = now.toISOString();
  await putBookMeta(store, userId, meta);

  const index = await getLibraryIndex(store, userId);
  await putLibraryIndex(store, userId, index.books.map((book) => (book.id === bookId ? meta : book)), now);

  return c.json({ book: meta });
});

/** DELETE /api/library/:bookId - removes the PDF, metadata, annotations and progress. */
libraryRoutes.delete('/:bookId', requireUser(), async (c) => {
  const store = c.get('store');
  const userId = c.get('user').id;
  const bookId = c.req.param('bookId');
  const now = c.get('now')();

  const meta = await getBookMeta(store, userId, bookId);
  if (!meta) throw notFound('That book is not in your library');

  await deleteBookObjects(store, userId, bookId);

  const index = await getLibraryIndex(store, userId);
  await putLibraryIndex(store, userId, index.books.filter((book) => book.id !== bookId), now);

  // Drop this book's slice of the notes index so its highlights disappear too.
  const annotationsIndex = await getAnnotationsIndex(store, userId);
  if (annotationsIndex.books[bookId]) {
    delete annotationsIndex.books[bookId];
    annotationsIndex.updatedAt = now.toISOString();
    await putAnnotationsIndex(store, userId, annotationsIndex);
  }

  return c.json({ ok: true, deleted: bookId });
});

/**
 * GET /api/library/:bookId/annotations
 *
 * Returns the raw EmbedPDF transfer items, to be fed straight back into
 * `annotationApi.importAnnotations()` when the reader opens.
 */
libraryRoutes.get('/:bookId/annotations', requireUser(), async (c) => {
  const store = c.get('store');
  const userId = c.get('user').id;
  const bookId = c.req.param('bookId');
  const meta = await getBookMeta(store, userId, bookId);
  if (!meta) throw notFound('That book is not in your library');

  const stored = await getBookAnnotations(store, userId, bookId, c.get('now')());
  return c.json({ annotations: stored.items, revision: stored.revision, updatedAt: stored.updatedAt });
});

/**
 * PUT /api/library/:bookId/annotations
 *
 * Body: `{ revision, items }`. The merge rule lives in mergeAnnotations: newer
 * wins by id, and deletions are only honoured when the client was actually up to
 * date. That means two devices annotating the same book can never silently erase
 * each other's work - a stale device can add and update, but not delete.
 */
libraryRoutes.put('/:bookId/annotations', requireUser(), async (c) => {
  const store = c.get('store');
  const userId = c.get('user').id;
  const bookId = c.req.param('bookId');
  const now = c.get('now')();

  const meta = await getBookMeta(store, userId, bookId);
  if (!meta) throw notFound('That book is not in your library');

  const body = await readJson(c.req.raw);
  if (!Array.isArray(body.items)) throw badRequest('"items" must be an array of annotation transfer items');
  if (body.items.length > 20_000) throw badRequest('That is more annotations than this book can hold');

  const incoming = (body.items as AnnotationTransferItemInput[]).filter(
    (item): item is AnnotationTransferItem =>
      Boolean(item) && typeof item === 'object' && typeof item.annotation === 'object' && item.annotation !== null,
  );

  const existing = await getBookAnnotations(store, userId, bookId, now);
  // Only a client that has seen the current revision is allowed to delete.
  const clientRevision = asInt(body.revision, 'revision', { min: 0, max: 1_000_000, fallback: -1 });
  const allowDeletes = clientRevision === existing.revision;

  const merged = mergeAnnotations(existing.items, incoming, { allowDeletes });
  const saved = {
    version: 1 as const,
    bookId,
    revision: existing.revision + 1,
    updatedAt: now.toISOString(),
    items: merged.merged,
  };
  await putBookAnnotations(store, userId, saved);

  const rows = await updateAnnotationsIndexForBook(store, userId, { id: bookId, title: meta.title }, saved.items, now);

  return c.json({
    revision: saved.revision,
    count: saved.items.length,
    added: merged.added,
    updated: merged.updated,
    removed: merged.removed,
    indexRows: rows.length,
    updatedAt: saved.updatedAt,
  });
});

/**
 * GET /api/library/:bookId/file
 *
 * Accepts either the session cookie or a `?t=` file token, and implements HTTP
 * range requests so the viewer can stream a large PDF without downloading it.
 */
libraryRoutes.get('/:bookId/file', async (c) => {
  const store = c.get('store');
  const bookId = c.req.param('bookId');
  const token = c.req.query('t');

  let userId: string | null = null;
  if (token) {
    userId = await verifyFileToken(token, bookId, c.env.SESSION_SECRET);
  }
  if (!userId) {
    userId = (await currentUser(c))?.id ?? null;
  }
  if (!userId) throw notFound('Not available');

  const key = keys.bookFile(userId, bookId);

  // Resolve a suffix range (`bytes=-500`) against the real size before reading.
  const rangeHeader = c.req.header('range');
  let offset: number | undefined;
  let length: number | undefined;
  let suffix: number | undefined;

  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (match) {
      if (match[1]) {
        offset = Number(match[1]);
        length = match[2] ? Math.max(0, Number(match[2]) - offset + 1) : undefined;
      } else if (match[2]) {
        suffix = Number(match[2]);
      }
    }
  }

  if (suffix !== undefined) {
    const head = await store.head(key);
    if (!head) throw notFound('That book has no stored file');
    offset = Math.max(0, head.size - suffix);
  }

  const object = await store.get(key, offset === undefined ? undefined : { offset, length });
  if (!object) throw notFound('That book has no stored file');

  const headers = new Headers({
    'Content-Type': 'application/pdf',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=600',
    'X-Content-Type-Options': 'nosniff',
  });

  if (offset !== undefined && object.range) {
    const start = object.range.offset;
    const size = object.range.length ?? object.size - start;
    headers.set('Content-Range', `bytes ${start}-${start + size - 1}/${object.size}`);
    headers.set('Content-Length', String(size));
    return new Response(object.stream(), { status: 206, headers });
  }

  headers.set('Content-Length', String(object.size));
  return new Response(object.stream(), { status: 200, headers });
});

/** GET /api/library/:bookId/progress */
libraryRoutes.get('/:bookId/progress', requireUser(), async (c) => {
  const progress = await getProgress(c.get('store'), c.get('user').id, c.req.param('bookId'));
  return c.json({ progress });
});

/**
 * PUT /api/library/:bookId/progress
 *
 * Also stamps `lastOpenedAt`, which is what "Continue reading" is sorted by.
 */
libraryRoutes.put('/:bookId/progress', requireUser(), async (c) => {
  const store = c.get('store');
  const userId = c.get('user').id;
  const bookId = c.req.param('bookId');
  const now = c.get('now')();
  const body = await readJson(c.req.raw);

  const meta = await getBookMeta(store, userId, bookId);
  if (!meta) throw notFound('That book is not in your library');

  const page = asInt(body.page, 'page', { min: 0, max: 100_000, fallback: 0 });
  const pageCount = asInt(body.pageCount, 'pageCount', { min: 1, max: 100_000, fallback: meta.pageCount ?? 1 });
  const percent = Math.max(0, Math.min(100, Math.round((page / Math.max(1, pageCount)) * 1000) / 10));

  const progress: BookProgress = {
    version: 1,
    bookId,
    page,
    pageCount,
    percent,
    updatedAt: now.toISOString(),
  };
  await putProgress(store, userId, progress);

  let changed = false;
  if (meta.lastOpenedAt !== progress.updatedAt) {
    meta.lastOpenedAt = progress.updatedAt;
    changed = true;
  }
  if (meta.pageCount !== pageCount) {
    meta.pageCount = pageCount;
    changed = true;
  }
  const nowFinished = percent >= 98;
  const finishedAt = nowFinished ? (meta.finishedAt ?? now.toISOString()) : meta.finishedAt;
  if (finishedAt !== meta.finishedAt) {
    meta.finishedAt = finishedAt;
    changed = true;
  }
  if (changed) {
    meta.updatedAt = now.toISOString();
    await putBookMeta(store, userId, meta);
    const index = await getLibraryIndex(store, userId);
    await putLibraryIndex(store, userId, index.books.map((book) => (book.id === bookId ? meta : book)), now);
  }

  return c.json({ progress });
});

/** Comma-separated tags from a form field. */
function splitCsv(value: string | File | null): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}
