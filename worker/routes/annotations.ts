/**
 * The Notes & Highlights page reads this index.
 *
 * One derived file (`index/annotations.json`) holds a compact row per
 * annotation across the whole library, so that page is a single read rather
 * than one read per book. The raw EmbedPDF payloads stay in each book's own
 * `annotations.json`, which is what actually round-trips through the viewer.
 */
import { Hono } from 'hono';
import { requireUser } from '../auth';
import type { AppEnv } from '../env';
import { asInt } from '../lib/http';
import { isMarkupKind, isTextualKind } from '../lib/annotations';
import { getAnnotationsIndex, getBookAnnotations, getLibraryIndex, putAnnotationsIndex } from '../lib/repo';
import type { AnnotationIndexItem } from '../lib/types';

export const annotationRoutes = new Hono<AppEnv>();

/**
 * GET /api/annotations
 *
 * Query: bookId, kind, q (free text), markupOnly=false, limit, offset, sort.
 * Filtering happens here so a large library does not ship every row to a phone.
 */
annotationRoutes.get('/', requireUser(), async (c) => {
  const store = c.get('store');
  const userId = c.get('user').id;
  const index = await getAnnotationsIndex(store, userId);

  const bookFilter = c.req.query('bookId');
  const kindFilter = c.req.query('kind');
  const search = c.req.query('q')?.trim().toLowerCase();
  const markupOnly = c.req.query('markupOnly') === 'true';
  const limit = asInt(c.req.query('limit'), 'limit', { min: 1, max: 1000, fallback: 500 });
  const offset = asInt(c.req.query('offset'), 'offset', { min: 0, max: 100_000, fallback: 0 });

  let rows: AnnotationIndexItem[] = [];
  for (const [bookId, slice] of Object.entries(index.books)) {
    if (bookFilter && bookId !== bookFilter) continue;
    for (const item of slice.items) {
      if (kindFilter && item.kind !== kindFilter) continue;
      if (markupOnly && !isMarkupKind(item.kind)) continue;
      if (
        search &&
        !`${item.text ?? ''} ${item.note ?? ''} ${item.bookTitle} ${item.kind}`.toLowerCase().includes(search)
      ) {
        continue;
      }
      rows.push(item);
    }
  }

  rows.sort((a, b) => {
    const left = new Date(b.updatedAt ?? b.createdAt ?? 0).getTime();
    const right = new Date(a.updatedAt ?? a.createdAt ?? 0).getTime();
    return left - right;
  });

  const total = rows.length;
  const page = rows.slice(offset, offset + limit);

  // Per-book and per-kind tallies for the filter UI, computed before paging.
  const byBook: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  for (const item of rows) {
    byBook[item.bookId] = (byBook[item.bookId] ?? 0) + 1;
    byKind[item.kind] = (byKind[item.kind] ?? 0) + 1;
  }

  return c.json({ annotations: page, total, offset, byBook, byKind, updatedAt: index.updatedAt });
});

/** GET /api/annotations/stats - small summary for the dashboard. */
annotationRoutes.get('/stats', requireUser(), async (c) => {
  const store = c.get('store');
  const index = await getAnnotationsIndex(store, c.get('user').id);

  let total = 0;
  let highlights = 0;
  let notes = 0;
  let withText = 0;
  for (const slice of Object.values(index.books)) {
    for (const item of slice.items) {
      total += 1;
      if (item.kind === 'highlight') highlights += 1;
      if (item.kind === 'note' || item.kind === 'text' || item.note) notes += 1;
      if (item.text) withText += 1;
    }
  }

  return c.json({ total, highlights, notes, withText, books: Object.keys(index.books).length });
});

/**
 * POST /api/annotations/reindex
 *
 * Rebuilds the notes index from every book's annotation file. The index is
 * derived data, so this is always safe to run and is the recovery path if it is
 * ever corrupted or edited by hand.
 */
annotationRoutes.post('/reindex', requireUser(), async (c) => {
  const store = c.get('store');
  const userId = c.get('user').id;
  const now = c.get('now')();

  const library = await getLibraryIndex(store, userId);
  const index = await getAnnotationsIndex(store, userId);
  let rebuilt = 0;

  for (const book of library.books) {
    const stored = await getBookAnnotations(store, userId, book.id, now);
    if (stored.items.length === 0) {
      if (index.books[book.id]) {
        delete index.books[book.id];
        rebuilt += 1;
      }
      continue;
    }
    const previous = index.books[book.id];
    const rows = (await import('../lib/annotations')).buildIndexItems(stored.items, book.id, book.title);
    for (const row of rows) {
      const carried = previous?.items.find((entry) => entry.id === row.id)?.quoteId;
      if (carried) row.quoteId = carried;
    }
    index.books[book.id] = {
      bookTitle: book.title,
      count: rows.length,
      updatedAt: stored.updatedAt,
      items: rows,
    };
    rebuilt += 1;
  }

  index.updatedAt = now.toISOString();
  await putAnnotationsIndex(store, userId, index);

  const rows = Object.values(index.books).reduce((sum, slice) => sum + slice.items.length, 0);
  return c.json({ books: rebuilt, annotations: rows });
});

/** Kinds the UI offers as filters, with a hint about which read as text. */
annotationRoutes.get('/kinds', (c) =>
  c.json({
    kinds: [
      { kind: 'highlight', label: 'Highlights', textual: true },
      { kind: 'underline', label: 'Underlines', textual: true },
      { kind: 'strikethrough', label: 'Strikeouts', textual: true },
      { kind: 'squiggly', label: 'Squiggly', textual: true },
      { kind: 'note', label: 'Sticky notes', textual: true },
      { kind: 'text', label: 'Text boxes', textual: true },
      { kind: 'ink', label: 'Ink', textual: false },
      { kind: 'square', label: 'Shapes', textual: false },
      { kind: 'stamp', label: 'Stamps', textual: false },
    ].map((entry) => ({ ...entry, default: isTextualKind(entry.kind) })),
  }),
);
