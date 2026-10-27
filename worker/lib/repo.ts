/**
 * Data access.
 *
 * Every read is defensive: a hand-edited, truncated or partially written file
 * falls back to a sane default instead of failing the request. Every write goes
 * through these helpers so the on-disk shape stays in one place.
 */
import type { ObjectStore } from './store';
import { keys } from './keys';
import {
  buildIndexItems,
  coerceBookAnnotations,
  emptyBookAnnotations,
} from './annotations';
import { datesOfIsoWeek, emptyNotebookDay, isIsoDate, isoWeekOf, parseDay } from './notebook';
import type {
  AnnotationsIndex,
  BookAnnotations,
  BookMeta,
  BookProgress,
  InstanceConfig,
  LibraryIndex,
  NotebookDay,
  QuoteCollection,
  UserRecord,
  UserSettings,
  UsersIndex,
} from './types';

async function readJson<T>(store: ObjectStore, key: string): Promise<T | null> {
  const object = await store.get(key);
  if (!object) return null;
  try {
    return JSON.parse(await object.text()) as T;
  } catch {
    return null;
  }
}

function writeJson(store: ObjectStore, key: string, value: unknown): Promise<void> {
  return store.put(key, JSON.stringify(value, null, 2), {
    contentType: 'application/json; charset=utf-8',
    cacheControl: 'no-store',
  });
}

/** Lists every key under a prefix, following R2's pagination cursor. */
export async function listAllKeys(store: ObjectStore, prefix: string): Promise<{ key: string; size: number }[]> {
  const out: { key: string; size: number }[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const result = await store.list({ prefix, cursor, limit: 1000 });
    out.push(...result.keys);
    if (!result.truncated || !result.cursor) break;
    cursor = result.cursor;
  }
  return out;
}

/* ------------------------------------------------------------------ instance */

export async function getInstanceConfig(store: ObjectStore, now: Date): Promise<InstanceConfig> {
  const stored = await readJson<InstanceConfig>(store, keys.instanceConfig());
  if (stored && typeof stored === 'object') {
    return {
      version: 1,
      ownerId: typeof stored.ownerId === 'string' ? stored.ownerId : null,
      // A missing instance record means a fresh install, and the first account
      // creates the owner. Anything else defaults to closed.
      registrationOpen: stored.registrationOpen !== false,
      createdAt: typeof stored.createdAt === 'string' ? stored.createdAt : now.toISOString(),
      updatedAt: typeof stored.updatedAt === 'string' ? stored.updatedAt : now.toISOString(),
    };
  }
  return {
    version: 1,
    ownerId: null,
    registrationOpen: true,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export function putInstanceConfig(store: ObjectStore, config: InstanceConfig): Promise<void> {
  return writeJson(store, keys.instanceConfig(), config);
}

/* --------------------------------------------------------------------- users */

export async function getUsersIndex(store: ObjectStore): Promise<UsersIndex> {
  const stored = await readJson<UsersIndex>(store, keys.usersIndex());
  const users = Array.isArray(stored?.users) ? stored!.users : [];
  return { version: 1, users: users.filter((user) => user && typeof user.id === 'string') };
}

export function putUsersIndex(store: ObjectStore, index: UsersIndex): Promise<void> {
  return writeJson(store, keys.usersIndex(), index);
}

export function getUser(store: ObjectStore, userId: string): Promise<UserRecord | null> {
  return readJson<UserRecord>(store, keys.user(userId));
}

export function putUser(store: ObjectStore, user: UserRecord): Promise<void> {
  return writeJson(store, keys.user(user.id), user);
}

export async function findUserByEmail(store: ObjectStore, hashedEmail: string): Promise<UserRecord | null> {
  const pointer = await readJson<{ userId?: string }>(store, keys.userByEmail(hashedEmail));
  if (!pointer?.userId) return null;
  return getUser(store, pointer.userId);
}

export function putEmailPointer(store: ObjectStore, hashedEmail: string, userId: string): Promise<void> {
  return writeJson(store, keys.userByEmail(hashedEmail), { userId });
}

/* ------------------------------------------------------------------ settings */

export function defaultSettings(): UserSettings {
  return {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    theme: 'system',
    reader: {
      annotationAuthor: '',
      highlightColor: '#ffd400',
      scrollStrategy: 'vertical',
      defaultZoom: 'fit-width',
      showThumbnails: false,
      autosaveSeconds: 20,
    },
    notebook: { carryOverTodos: true, showWeek: true },
    quotes: { quoteOfTheDay: true, compactLayout: false },
    library: { sortBy: 'recent', view: 'grid' },
  };
}

/**
 * Field-by-field merge over the defaults, so a settings file written by an older
 * or newer build of the app still loads.
 */
export function mergeSettings(stored: Partial<UserSettings> | null): UserSettings {
  const base = defaultSettings();
  if (!stored || typeof stored !== 'object') return base;
  const reader = { ...base.reader, ...(stored.reader ?? {}) };
  const notebook = { ...base.notebook, ...(stored.notebook ?? {}) };
  const quotes = { ...base.quotes, ...(stored.quotes ?? {}) };
  const library = { ...base.library, ...(stored.library ?? {}) };
  return {
    version: 1,
    updatedAt: typeof stored.updatedAt === 'string' ? stored.updatedAt : base.updatedAt,
    theme: stored.theme === 'light' || stored.theme === 'dark' || stored.theme === 'system' ? stored.theme : base.theme,
    reader: {
      ...reader,
      autosaveSeconds: Math.min(600, Math.max(5, Number(reader.autosaveSeconds) || base.reader.autosaveSeconds)),
      scrollStrategy: reader.scrollStrategy === 'horizontal' ? 'horizontal' : 'vertical',
      showThumbnails: Boolean(reader.showThumbnails),
    },
    notebook: { carryOverTodos: Boolean(notebook.carryOverTodos), showWeek: Boolean(notebook.showWeek) },
    quotes: { quoteOfTheDay: Boolean(quotes.quoteOfTheDay), compactLayout: Boolean(quotes.compactLayout) },
    library: {
      sortBy: ['recent', 'title', 'author', 'added'].includes(library.sortBy) ? library.sortBy : base.library.sortBy,
      view: library.view === 'list' ? 'list' : 'grid',
    },
  };
}

export async function getSettings(store: ObjectStore, userId: string): Promise<UserSettings> {
  return mergeSettings(await readJson<Partial<UserSettings>>(store, keys.settings(userId)));
}

export function putSettings(store: ObjectStore, userId: string, settings: UserSettings): Promise<void> {
  return writeJson(store, keys.settings(userId), settings);
}

/* ------------------------------------------------------------------- library */

export async function getLibraryIndex(store: ObjectStore, userId: string): Promise<LibraryIndex> {
  const stored = await readJson<LibraryIndex>(store, keys.libraryIndex(userId));
  return stored && Array.isArray(stored.books) ? stored : { version: 1, updatedAt: '', books: [] };
}

export function putLibraryIndex(store: ObjectStore, userId: string, books: BookMeta[], now: Date): Promise<void> {
  const index: LibraryIndex = { version: 1, updatedAt: now.toISOString(), books };
  return writeJson(store, keys.libraryIndex(userId), index);
}

export function getBookMeta(store: ObjectStore, userId: string, bookId: string): Promise<BookMeta | null> {
  return readJson<BookMeta>(store, keys.bookMeta(userId, bookId));
}

export function putBookMeta(store: ObjectStore, userId: string, meta: BookMeta): Promise<void> {
  return writeJson(store, keys.bookMeta(userId, meta.id), meta);
}

export function getProgress(store: ObjectStore, userId: string, bookId: string): Promise<BookProgress | null> {
  return readJson<BookProgress>(store, keys.bookProgress(userId, bookId));
}

export function putProgress(store: ObjectStore, userId: string, progress: BookProgress): Promise<void> {
  return writeJson(store, keys.bookProgress(userId, progress.bookId), progress);
}

/** Removes a book completely, including its PDF, annotations and progress. */
export async function deleteBookObjects(store: ObjectStore, userId: string, bookId: string): Promise<number> {
  const objects = await listAllKeys(store, keys.bookPrefix(userId, bookId));
  if (objects.length) await store.delete(objects.map((object) => object.key));
  return objects.length;
}

/**
 * Rebuilds the library listing from the per-book metadata files, which are the
 * source of truth. Available as an API call in case the cached index ever drifts.
 */
export async function rebuildLibraryIndex(store: ObjectStore, userId: string, now: Date): Promise<BookMeta[]> {
  const objects = await listAllKeys(store, keys.libraryPrefix(userId));
  const bookIds = new Set<string>();
  for (const object of objects) {
    const bookId = keys.bookIdFromKey(userId, object.key);
    if (bookId) bookIds.add(bookId);
  }
  const metas: BookMeta[] = [];
  for (const bookId of bookIds) {
    const meta = await getBookMeta(store, userId, bookId);
    if (meta) metas.push(meta);
  }
  metas.sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1));
  await putLibraryIndex(store, userId, metas, now);
  return metas;
}

/* --------------------------------------------------------------- annotations */

export async function getBookAnnotations(
  store: ObjectStore,
  userId: string,
  bookId: string,
  now: Date,
): Promise<BookAnnotations> {
  return coerceBookAnnotations(await readJson<unknown>(store, keys.bookAnnotations(userId, bookId)), bookId, now.toISOString());
}

export function putBookAnnotations(store: ObjectStore, userId: string, value: BookAnnotations): Promise<void> {
  return writeJson(store, keys.bookAnnotations(userId, value.bookId), value);
}

export async function getAnnotationsIndex(store: ObjectStore, userId: string): Promise<AnnotationsIndex> {
  const stored = await readJson<AnnotationsIndex>(store, keys.annotationsIndex(userId));
  if (stored && typeof stored === 'object' && stored.books && typeof stored.books === 'object') return stored;
  return { version: 1, updatedAt: '', books: {} };
}

export function putAnnotationsIndex(store: ObjectStore, userId: string, index: AnnotationsIndex): Promise<void> {
  return writeJson(store, keys.annotationsIndex(userId), index);
}

export function emptyAnnotationsIndex(): AnnotationsIndex {
  return { version: 1, updatedAt: '', books: {} };
}

/**
 * Rewrites one book's slice of the notes index.
 *
 * `quoteId` links are carried across from the previous slice, so rebuilding the
 * index never loses the fact that a highlight has already been promoted into the
 * quote collection.
 */
export async function updateAnnotationsIndexForBook(
  store: ObjectStore,
  userId: string,
  book: { id: string; title: string },
  items: import('./types').AnnotationTransferItem[],
  now: Date,
): Promise<import('./types').AnnotationIndexItem[]> {
  const index = await getAnnotationsIndex(store, userId);
  const previous = index.books[book.id];
  const rows = buildIndexItems(items, book.id, book.title);
  for (const row of rows) {
    const carried = previous?.items.find((entry) => entry.id === row.id)?.quoteId;
    if (carried) row.quoteId = carried;
  }

  if (rows.length === 0) delete index.books[book.id];
  else {
    index.books[book.id] = {
      bookTitle: book.title,
      count: rows.length,
      updatedAt: now.toISOString(),
      items: rows,
    };
  }
  index.updatedAt = now.toISOString();
  await putAnnotationsIndex(store, userId, index);
  return rows;
}

/* -------------------------------------------------------------------- quotes */

export async function getQuotes(store: ObjectStore, userId: string): Promise<QuoteCollection> {
  const stored = await readJson<QuoteCollection>(store, keys.quotes(userId));
  const quotes = Array.isArray(stored?.quotes) ? stored!.quotes.filter((quote) => quote && typeof quote.id === 'string') : [];
  return { version: 1, updatedAt: stored?.updatedAt ?? '', quotes };
}

export function putQuotes(store: ObjectStore, userId: string, collection: QuoteCollection): Promise<void> {
  return writeJson(store, keys.quotes(userId), collection);
}

/* ------------------------------------------------------------------ notebook */

export async function getNotebookDay(
  store: ObjectStore,
  userId: string,
  date: string,
  week = isoWeekOf(date),
): Promise<NotebookDay> {
  const object = await store.get(keys.notebookDay(userId, week, date));
  if (!object) return emptyNotebookDay(date, week);
  // A day that exists is a day that was written; the timestamp is what tells the
  // page to show "saved" rather than "not written yet".
  return parseDay(date, await object.text(), object.uploaded?.toISOString() ?? null);
}

export async function putNotebookDay(
  store: ObjectStore,
  userId: string,
  date: string,
  markdown: string,
  week = isoWeekOf(date),
): Promise<NotebookDay> {
  await store.put(keys.notebookDay(userId, week, date), markdown, {
    contentType: 'text/markdown; charset=utf-8',
    cacheControl: 'no-store',
  });
  return parseDay(date, markdown, new Date().toISOString());
}

/** Dates that have a notebook file at all - drives the streak. */
export async function listNotebookDates(store: ObjectStore, userId: string): Promise<Set<string>> {
  const objects = await listAllKeys(store, keys.notebookPrefix(userId));
  const dates = new Set<string>();
  for (const object of objects) {
    const match = /(\d{4}-\d{2}-\d{2})\.md$/.exec(object.key);
    if (match?.[1] && isIsoDate(match[1])) dates.add(match[1]);
  }
  return dates;
}

export async function getNotebookWeek(store: ObjectStore, userId: string, week: string): Promise<NotebookDay[]> {
  const dates = datesOfIsoWeek(week);
  return Promise.all(dates.map((date) => getNotebookDay(store, userId, date, week)));
}
