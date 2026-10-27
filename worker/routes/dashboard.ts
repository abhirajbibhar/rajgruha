/**
 * The dashboard is one request, not six.
 *
 * A phone on a slow connection should be able to paint the home screen from a
 * single round trip, so this route fans out over R2 internally and returns one
 * document with everything the home screen needs.
 *
 * Reads are bounded on purpose: progress files are only fetched for books that
 * have actually been opened, and with limited concurrency, so a large library
 * cannot turn one dashboard load into hundreds of parallel R2 operations.
 */
import { Hono } from 'hono';
import { requireUser } from '../auth';
import type { AppEnv } from '../env';
import { pickQuoteOfTheDay, sortQuotes } from '../lib/quotes';
import { applyDayPatch, computeStreak, isoWeekOf } from '../lib/notebook';
import {
  getAnnotationsIndex,
  getBookAnnotations,
  getLibraryIndex,
  getNotebookDay,
  getProgress,
  getQuotes,
  getSettings,
  listNotebookDates,
  putNotebookDay,
  rebuildLibraryIndex,
} from '../lib/repo';
import type { AnnotationIndexItem, BookMeta, BookProgress, Quote } from '../lib/types';

export const dashboardRoutes = new Hono<AppEnv>();

/** Runs async work with a ceiling on how many operations are in flight at once. */
async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index] as T);
    }
  });
  await Promise.all(runners);
  return results;
}

const CONTINUE_LIMIT = 4;
const RECENT_LIMIT = 8;
const PROGRESS_READ_LIMIT = 60;

/** GET /api/dashboard */
dashboardRoutes.get('/dashboard', requireUser(), async (c) => {
  const store = c.get('store');
  const userId = c.get('user').id;
  const now = c.get('now')();
  const today = c.req.query('date') ?? now.toISOString().slice(0, 10);

  let library = await getLibraryIndex(store, userId);
  if (library.books.length === 0) {
    const objects = await store.list({ prefix: `u/${userId}/library/`, limit: 1 });
    if (objects.keys.length > 0) {
      const rebuilt = await rebuildLibraryIndex(store, userId, now);
      library = { version: 1, updatedAt: now.toISOString(), books: rebuilt };
    }
  }

  // Only opened books can have a reading position worth fetching.
  const opened = library.books
    .filter((book) => book.lastOpenedAt)
    .sort((a, b) => new Date(b.lastOpenedAt ?? 0).getTime() - new Date(a.lastOpenedAt ?? 0).getTime())
    .slice(0, PROGRESS_READ_LIMIT);

  const [quoteCollection, annotationsIndex, settings, notebookDates, todayEntry, progressEntries] = await Promise.all([
    getQuotes(store, userId),
    getAnnotationsIndex(store, userId),
    getSettings(store, userId),
    listNotebookDates(store, userId),
    getNotebookDay(store, userId, today),
    mapLimit(opened, 8, async (book) => ({ bookId: book.id, progress: await getProgress(store, userId, book.id) })),
  ]);

  const progressByBook = new Map<string, BookProgress>();
  for (const entry of progressEntries) {
    if (entry.progress) progressByBook.set(entry.bookId, entry.progress);
  }

  const withBook = (book: BookMeta) => ({ book, progress: progressByBook.get(book.id) ?? null });

  const continueReading = library.books
    .filter((book) => {
      const progress = progressByBook.get(book.id);
      return progress !== undefined && progress.percent > 0 && progress.percent < 98;
    })
    .sort((a, b) => {
      const left = progressByBook.get(a.id)?.updatedAt ?? '';
      const right = progressByBook.get(b.id)?.updatedAt ?? '';
      return right.localeCompare(left);
    })
    .slice(0, CONTINUE_LIMIT)
    .map(withBook);

  const recentlyAdded = [...library.books]
    .sort((a, b) => b.addedAt.localeCompare(a.addedAt))
    .slice(0, RECENT_LIMIT)
    .map(withBook);

  const startedRecently = [...library.books]
    .filter((book) => book.lastOpenedAt && !continueReading.some((entry) => entry.book.id === book.id))
    .sort((a, b) => (b.lastOpenedAt ?? '').localeCompare(a.lastOpenedAt ?? ''))
    .slice(0, 5)
    .map(withBook);

  // Aggregate annotation stats from the derived index - no per-book reads.
  let annotations = 0;
  let highlights = 0;
  let notes = 0;
  for (const slice of Object.values(annotationsIndex.books)) {
    for (const item of slice.items) {
      annotations += 1;
      if (item.kind === 'highlight') highlights += 1;
      if (item.note || item.kind === 'note' || item.kind === 'text') notes += 1;
    }
  }

  const recentlyAnnotated: AnnotationIndexItem[] = Object.values(annotationsIndex.books)
    .flatMap((slice) => slice.items)
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    .slice(0, 5);

  const tagCounts = new Map<string, number>();
  for (const book of library.books) {
    for (const tag of book.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }

  const finished = library.books.filter((book) => book.finishedAt).length;
  const inProgress = library.books.filter((book) => {
    const progress = progressByBook.get(book.id);
    return progress !== undefined && progress.percent > 0 && progress.percent < 98;
  }).length;

  const pagesRead = [...progressByBook.values()].reduce((sum, progress) => sum + progress.page, 0);

  const recentQuotes: Quote[] = sortQuotes(quoteCollection.quotes, 'recent').slice(0, 5);

  return c.json({
    generatedAt: now.toISOString(),
    today,
    week: isoWeekOf(today),
    continueReading,
    recentlyAdded,
    startedRecently,
    quoteOfTheDay: settings.quotes.quoteOfTheDay
      ? pickQuoteOfTheDay(quoteCollection.quotes, today, userId)
      : null,
    recentQuotes,
    recentlyAnnotated,
    tags: [...tagCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 24),
    shelves: [...new Set(library.books.map((book) => book.shelf).filter(Boolean))].sort(),
    notebook: {
      date: today,
      streak: computeStreak(notebookDates, today),
      totalDays: notebookDates.size,
      todos: todayEntry.todos,
      remarks: todayEntry.remarks,
      written: todayEntry.updatedAt !== null,
      updatedAt: todayEntry.updatedAt,
    },
    stats: {
      books: library.books.length,
      inProgress,
      finished,
      pagesRead,
      annotations,
      highlights,
      notes,
      quotes: quoteCollection.quotes.length,
      favorites: library.books.filter((book) => book.favorite).length,
      annotatedBooks: Object.keys(annotationsIndex.books).length,
      notebookDays: notebookDates.size,
      streak: computeStreak(notebookDates, today),
    },
    settings: { theme: settings.theme, library: settings.library, quotes: settings.quotes },
  });
});

/**
 * GET /api/export
 *
 * A complete, self-describing JSON dump of one user's data: books, annotations,
 * quotes, notebook days and settings. PDF bytes are deliberately not inlined -
 * they are the original files and are best copied with any S3 tool (see README).
 */
dashboardRoutes.get('/export', requireUser(), async (c) => {
  const store = c.get('store');
  const userId = c.get('user').id;
  const now = c.get('now')();
  const today = now.toISOString().slice(0, 10);

  const [library, quotes, settings, notebookDates] = await Promise.all([
    getLibraryIndex(store, userId),
    getQuotes(store, userId),
    getSettings(store, userId),
    listNotebookDates(store, userId),
  ]);

  const annotations: Record<string, unknown> = {};
  await mapLimit(library.books, 6, async (book) => {
    const stored = await getBookAnnotations(store, userId, book.id, now);
    annotations[book.id] = { bookTitle: book.title, ...stored };
  });

  const notebook: Record<string, string> = {};
  for (const date of [...notebookDates].sort()) {
    const day = await getNotebookDay(store, userId, date);
    notebook[date] = day.markdown;
  }

  return c.json({
    format: 'rajgruha-export',
    version: 1,
    exportedAt: now.toISOString(),
    user: { id: userId, email: c.get('user').email, name: c.get('user').name },
    books: library.books,
    annotations,
    quotes,
    notebook,
    settings,
    note: 'PDF bytes are not included. They live unchanged at u/<userId>/library/<bookId>/book.pdf in the R2 bucket.',
  });
});

/**
 * POST /api/notebook/carry-over
 *
 * Copies yesterday's unfinished todos into today's page. Existing lines are
 * matched by text so pressing it twice never duplicates work.
 */
dashboardRoutes.post('/notebook/carry-over', requireUser(), async (c) => {
  const store = c.get('store');
  const userId = c.get('user').id;
  const now = c.get('now')();
  const body = (await c.req.json().catch(() => ({}))) as { date?: unknown };
  const date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
    ? body.date
    : now.toISOString().slice(0, 10);

  const previousDate = new Date(`${date}T00:00:00Z`);
  previousDate.setUTCDate(previousDate.getUTCDate() - 1);

  const [previous, current] = await Promise.all([
    getNotebookDay(store, userId, previousDate.toISOString().slice(0, 10)),
    getNotebookDay(store, userId, date),
  ]);

  const outstanding = previous.todos.filter(
    (todo) => !todo.done && !current.todos.some((existing) => existing.text === todo.text),
  );
  if (outstanding.length === 0) {
    return c.json({ day: current, carried: 0 });
  }

  const markdown = applyDayPatch(current.markdown, { todos: [...current.todos, ...outstanding] });
  const saved = await putNotebookDay(store, userId, date, markdown);
  return c.json({ day: saved, carried: outstanding.length });
});
