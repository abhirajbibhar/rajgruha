/**
 * The quote collection.
 *
 * Quotes are one JSON file per user. A quote can stand alone, or carry an
 * `origin` pointing back at the PDF annotation it came from - that link is what
 * lets the quote page offer "jump to book", and it is also what makes promoting
 * the same highlight twice a no-op instead of a duplicate.
 */
import { Hono } from 'hono';
import { requireUser } from '../auth';
import type { AppEnv } from '../env';
import { asBool, asInt, asString, asStringArray, badRequest, notFound, readJson } from '../lib/http';
import { createQuote, pickQuoteOfTheDay, quoteFacets, sortQuotes } from '../lib/quotes';
import {
  getAnnotationsIndex,
  getBookMeta,
  getQuotes,
  putAnnotationsIndex,
  putQuotes,
} from '../lib/repo';
import type { Quote } from '../lib/types';

export const quoteRoutes = new Hono<AppEnv>();

function normaliseText(value: unknown): string {
  const text = asString(value, 'text', { max: 4000 });
  if (!text) throw badRequest('A quote needs some text');
  return text;
}

/** GET /api/quotes */
quoteRoutes.get('/', requireUser(), async (c) => {
  const store = c.get('store');
  const userId = c.get('user').id;
  const collection = await getQuotes(store, userId);
  const sortBy = c.req.query('sort') ?? 'recent';
  const search = c.req.query('q')?.trim().toLowerCase();
  const tag = c.req.query('tag');
  const favoriteOnly = c.req.query('favorite') === 'true';

  let quotes = collection.quotes;
  if (tag) quotes = quotes.filter((quote) => quote.tags.includes(tag));
  if (favoriteOnly) quotes = quotes.filter((quote) => quote.favorite);
  if (search) {
    quotes = quotes.filter((quote) =>
      `${quote.text} ${quote.author} ${quote.source} ${quote.tags.join(' ')}`.toLowerCase().includes(search),
    );
  }

  return c.json({
    quotes: sortQuotes(quotes, sortBy),
    total: quotes.length,
    facets: quoteFacets(collection.quotes),
    favorites: collection.quotes.filter((quote) => quote.favorite).length,
    updatedAt: collection.updatedAt,
  });
});

/** GET /api/quotes/daily - the same quote all day on every device. */
quoteRoutes.get('/daily', requireUser(), async (c) => {
  const store = c.get('store');
  const userId = c.get('user').id;
  const date = c.req.query('date') ?? c.get('now')().toISOString().slice(0, 10);
  const collection = await getQuotes(store, userId);
  return c.json({ date, quote: pickQuoteOfTheDay(collection.quotes, date, userId) });
});

/** POST /api/quotes */
quoteRoutes.post('/', requireUser(), async (c) => {
  const store = c.get('store');
  const userId = c.get('user').id;
  const now = c.get('now')();
  const body = await readJson(c.req.raw);

  const quote = createQuote(
    {
      text: normaliseText(body.text),
      author: asString(body.author, 'author', { max: 160, required: false }),
      source: asString(body.source, 'source', { max: 300, required: false }),
      tags: asStringArray(body.tags, 'tags'),
      favorite: asBool(body.favorite, 'favorite'),
      note: asString(body.note, 'note', { max: 4000, required: false }),
    },
    now,
  );

  const collection = await getQuotes(store, userId);
  collection.quotes = [quote, ...collection.quotes];
  collection.updatedAt = now.toISOString();
  await putQuotes(store, userId, collection);

  return c.json({ quote }, 201);
});

/**
 * POST /api/quotes/from-annotation
 *
 * Promotes a highlight or note into the collection. The text is taken from the
 * annotation when the client does not supply an override; the annotation's own
 * comment becomes the quote's source note.
 */
quoteRoutes.post('/from-annotation', requireUser(), async (c) => {
  const store = c.get('store');
  const userId = c.get('user').id;
  const now = c.get('now')();
  const body = await readJson(c.req.raw);

  const bookId = asString(body.bookId, 'bookId', { max: 80 });
  const annotationId = asString(body.annotationId, 'annotationId', { max: 120 });

  const index = await getAnnotationsIndex(store, userId);
  const slice = index.books[bookId];
  const item = slice?.items.find((entry) => entry.id === annotationId);
  if (!item) throw notFound('That annotation is not in your notes index');

  const collection = await getQuotes(store, userId);

  // Promoting the same highlight twice returns the existing quote instead of
  // creating a duplicate, so the button is safe to press repeatedly.
  const existing = collection.quotes.find((quote) => quote.origin?.annotationId === annotationId);
  const book = await getBookMeta(store, userId, bookId);

  const textOverride = typeof body.text === 'string' ? asString(body.text, 'text', { max: 4000, required: false }) : '';
  const text = textOverride || item.text || item.note;
  if (!text) throw badRequest('That annotation has no text yet - add a note to it first, or type the quote yourself');

  if (existing) {
    existing.text = text;
    existing.updatedAt = now.toISOString();
    if (body.note !== undefined && asString(body.note, 'note', { max: 4000, required: false })) {
      existing.note = asString(body.note, 'note', { max: 4000, required: false });
    }
    if (body.tags !== undefined) existing.tags = asStringArray(body.tags, 'tags');
    if (body.author !== undefined) existing.author = asString(body.author, 'author', { max: 160, required: false });
    collection.updatedAt = now.toISOString();
    await putQuotes(store, userId, collection);
    if (item.quoteId !== existing.id) {
      item.quoteId = existing.id;
      await putAnnotationsIndex(store, userId, index);
    }
    return c.json({ quote: existing, created: false });
  }

  const quote = createQuote(
    {
      text,
      author: asString(body.author, 'author', { max: 160, required: false }),
      source: asString(body.source, 'source', { max: 300, required: false }) || book?.title || slice?.bookTitle || '',
      tags: asStringArray(body.tags, 'tags'),
      favorite: asBool(body.favorite, 'favorite'),
      origin: {
        bookId,
        bookTitle: book?.title ?? slice?.bookTitle ?? 'Unknown book',
        page: item.page,
        annotationId,
        annotationKind: item.kind,
      },
    },
    now,
  );
  // The annotation's own comment rides along as the quote's note, so the quote
  // page can show the highlight and the thought behind it together.
  if (item.note && item.note !== text) quote.note = item.note;

  collection.quotes = [quote, ...collection.quotes];
  collection.updatedAt = now.toISOString();
  await putQuotes(store, userId, collection);

  item.quoteId = quote.id;
  index.updatedAt = now.toISOString();
  await putAnnotationsIndex(store, userId, index);

  return c.json({ quote, created: true }, 201);
});

/** PATCH /api/quotes/:id */
quoteRoutes.patch('/:id', requireUser(), async (c) => {
  const store = c.get('store');
  const userId = c.get('user').id;
  const now = c.get('now')();
  const body = await readJson(c.req.raw);

  const collection = await getQuotes(store, userId);
  const quote = collection.quotes.find((entry) => entry.id === c.req.param('id'));
  if (!quote) throw notFound('That quote is not in your collection');

  if (body.text !== undefined) quote.text = normaliseText(body.text);
  if (body.note !== undefined) quote.note = asString(body.note, 'note', { max: 4000, required: false });
  if (body.author !== undefined) quote.author = asString(body.author, 'author', { max: 160, required: false });
  if (body.source !== undefined) quote.source = asString(body.source, 'source', { max: 300, required: false });
  if (body.tags !== undefined) quote.tags = asStringArray(body.tags, 'tags');
  if (body.favorite !== undefined) quote.favorite = asBool(body.favorite, 'favorite');
  quote.updatedAt = now.toISOString();

  collection.updatedAt = now.toISOString();
  await putQuotes(store, userId, collection);
  return c.json({ quote });
});

/** DELETE /api/quotes/:id */
quoteRoutes.delete('/:id', requireUser(), async (c) => {
  const store = c.get('store');
  const userId = c.get('user').id;
  const now = c.get('now')();
  const quoteId = c.req.param('id');

  const collection = await getQuotes(store, userId);
  const quote = collection.quotes.find((entry) => entry.id === quoteId);
  if (!quote) throw notFound('That quote is not in your collection');

  collection.quotes = collection.quotes.filter((entry) => entry.id !== quoteId);
  collection.updatedAt = now.toISOString();
  await putQuotes(store, userId, collection);

  // Clear the back-reference so the annotation offers "add to quotes" again.
  if (quote.origin) {
    const index = await getAnnotationsIndex(store, userId);
    const item = index.books[quote.origin.bookId]?.items.find((entry) => entry.id === quote.origin?.annotationId);
    if (item?.quoteId === quoteId) {
      item.quoteId = null;
      index.updatedAt = now.toISOString();
      await putAnnotationsIndex(store, userId, index);
    }
  }

  return c.json({ ok: true, deleted: quoteId });
});

/** GET /api/quotes/export - the raw JSON file, for backups. */
quoteRoutes.get('/export', requireUser(), async (c) => {
  const collection = await getQuotes(c.get('store'), c.get('user').id);
  return c.json(collection);
});

export type { Quote };
