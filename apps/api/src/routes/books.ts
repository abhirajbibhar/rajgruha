import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { BookInput, BookListQuery, BookPatch, FILES_ROOT, ProgressInput, type BookList, type BookSort, type Facets } from '@rajgruha/shared';
import { requireAdmin, requireAuth } from '../auth';
import { BOOK_SELECT, insertBookStatement, rowToBook, type BookRow } from '../db';
import type { AppEnv } from '../types';

export const bookRoutes = new Hono<AppEnv>();
bookRoutes.use('*', requireAuth);

const TIE = 'b.title COLLATE NOCASE ASC, b.id ASC';
const SORTS: Record<BookSort, { expr: string; dir: 'ASC' | 'DESC' }> = {
  recent: { expr: 'b.added_at', dir: 'DESC' },
  title: { expr: 'b.title COLLATE NOCASE', dir: 'ASC' },
  author: { expr: 'b.author COLLATE NOCASE', dir: 'ASC' },
  rating: { expr: 'b.rating', dir: 'DESC' },
  popular: { expr: 'b.rating_count', dir: 'DESC' },
  format: { expr: 'b.format', dir: 'ASC' },
  pages: { expr: 'b.pages', dir: 'DESC' },
  status: { expr: 'p.status', dir: 'ASC' },
  genre: { expr: 'b.genres', dir: 'ASC' }
};

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);
type Ctx = { env: AppEnv['Bindings']; get: (k: 'user') => { id: string } };

// GET /api/books?q=&format=&genre=&status=&sort=&dir=&page=&pageSize=
bookRoutes.get('/', async (c) => {
  const parsed = BookListQuery.safeParse(c.req.query());
  if (!parsed.success) throw new HTTPException(400, { message: 'Invalid query' });
  const { q, format, genre, status, sort, dir, page, pageSize } = parsed.data;
  const userId = c.get('user').id;

  const where: string[] = [];
  const params: unknown[] = [userId]; // ?1 = user id for the progress join
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace('?', `?${params.length}`));
  };

  if (q) {
    params.push(`%${escapeLike(q)}%`);
    const n = params.length;
    where.push(`(b.title LIKE ?${n} ESCAPE '\\' OR b.author LIKE ?${n} ESCAPE '\\' OR b.isbn LIKE ?${n} ESCAPE '\\')`);
  }
  if (format) add('b.format = ?', format);
  if (genre) add(`b.genres LIKE ? ESCAPE '\\'`, `%${escapeLike(JSON.stringify(genre))}%`);
  if (status) add('p.status = ?', status);

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const from = `FROM books b LEFT JOIN reading_progress p ON p.book_id = b.id AND p.user_id = ?1 ${whereSql}`;
  const s = SORTS[sort];
  const order = `${s.expr} ${dir ? dir.toUpperCase() : s.dir}, ${TIE}`;

  const [{ results }, count] = (await c.env.DB.batch([
    c.env.DB.prepare(`SELECT ${BOOK_SELECT} ${from} ORDER BY ${order} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`).bind(...params),
    c.env.DB.prepare(`SELECT COUNT(*) AS n ${from}`).bind(...params)
  ])) as [D1Result<BookRow>, D1Result<{ n: number }>];

  const body: BookList = { items: results.map(rowToBook), total: count.results[0]?.n ?? 0, page, pageSize };
  return c.json(body);
});

// Filter options derived from what's actually in the library.
bookRoutes.get('/facets', async (c) => {
  const [genres, formats] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT j.value AS name, COUNT(*) AS count FROM books b, json_each(b.genres) j GROUP BY j.value ORDER BY count DESC, name COLLATE NOCASE'),
    c.env.DB.prepare('SELECT format, COUNT(*) AS count FROM books GROUP BY format ORDER BY count DESC')
  ]);
  const body: Facets = { genres: genres!.results as Facets['genres'], formats: formats!.results as Facets['formats'] };
  return c.json(body);
});

// Books the user is reading, most recently touched first (Overview → Continue reading)
bookRoutes.get('/continue', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT ${BOOK_SELECT} FROM reading_progress p JOIN books b ON b.id = p.book_id
     WHERE p.user_id = ?1 AND p.status = 'reading' ORDER BY p.updated_at DESC LIMIT 6`
  ).bind(c.get('user').id).all<BookRow>();
  return c.json(results.map(rowToBook));
});

export async function findBookRow(c: Ctx, idOrSlug: string) {
  const row = await c.env.DB.prepare(
    `SELECT ${BOOK_SELECT} FROM books b
     LEFT JOIN reading_progress p ON p.book_id = b.id AND p.user_id = ?1
     WHERE b.id = ?2 OR b.slug = ?2`
  ).bind(c.get('user').id, idOrSlug).first<BookRow>();
  if (!row) throw new HTTPException(404, { message: 'Book not found' });
  return row;
}

bookRoutes.get('/:id', async (c) => c.json(rowToBook(await findBookRow(c, c.req.param('id')))));

/**
 * Stream an R2 object, honouring Range (the PDF viewer needs it) and conditional requests.
 * Files can be replaced at any time (e.g. after editing a PDF), so we never let the browser reuse a copy
 * blindly: `no-cache` means "revalidate every time", and a matching ETag costs only a 304.
 */
export async function streamObject(c: { env: AppEnv['Bindings']; req: { header: (n: string) => string | undefined; raw: Request } }, key: string, fallbackType: string) {
  if (!c.env.FILES) throw new HTTPException(501, { message: 'File storage (R2) is not configured' });
  const range = c.req.header('Range');
  const object = await c.env.FILES.get(key, { onlyIf: c.req.raw.headers, ...(range ? { range: c.req.raw.headers } : {}) });
  if (!object) throw new HTTPException(404, { message: 'File missing from storage' });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', 'private, no-cache');
  if (!('body' in object)) return new Response(null, { status: 304, headers }); // client's copy is current
  if (!headers.has('content-type')) headers.set('content-type', fallbackType);
  if (range && 'range' in object && object.range && 'offset' in object.range) {
    const { offset, length } = object.range as { offset: number; length: number };
    headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
    return new Response((object as R2ObjectBody).body, { status: 206, headers });
  }
  return new Response((object as R2ObjectBody).body, { headers });
}

bookRoutes.get('/:id/file', async (c) => {
  const book = await findBookRow(c, c.req.param('id'));
  if (!book.file_key) throw new HTTPException(404, { message: 'No file uploaded for this book' });
  return streamObject(c, book.file_key, book.format === 'pdf' ? 'application/pdf' : 'application/epub+zip');
});

bookRoutes.get('/:id/cover', async (c) => {
  const book = await findBookRow(c, c.req.param('id'));
  if (!book.cover_key) throw new HTTPException(404, { message: 'No uploaded cover' });
  return streamObject(c, book.cover_key, 'image/jpeg');
});

bookRoutes.put('/:id/progress', async (c) => {
  const body = ProgressInput.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw new HTTPException(400, { message: 'Invalid progress payload' });
  const book = await findBookRow(c, c.req.param('id'));
  const { percent, location } = body.data;
  const status = body.data.status ?? (percent >= 99 ? 'finished' : 'reading');

  await c.env.DB.prepare(
    `INSERT INTO reading_progress (user_id, book_id, status, percent, location)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT (user_id, book_id) DO UPDATE SET
       status = excluded.status, percent = excluded.percent,
       location = COALESCE(excluded.location, reading_progress.location),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
  ).bind(c.get('user').id, book.id, status, percent, location ?? null).run();

  return c.json(rowToBook(await findBookRow(c, book.id)));
});

// ── Admin ────────────────────────────────────────────────────────
bookRoutes.post('/', requireAdmin, async (c) => {
  const body = BookInput.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw new HTTPException(400, { message: body.error.issues[0]?.message ?? 'Invalid book' });
  const id = crypto.randomUUID();
  try {
    await insertBookStatement(c.env.DB, id, body.data).run();
  } catch (e) {
    const msg = String(e);
    if (msg.includes('file_key')) throw new HTTPException(409, { message: 'That file is already in the library' });
    if (msg.includes('UNIQUE')) throw new HTTPException(409, { message: 'A book with that slug exists' });
    throw e;
  }
  return c.json(rowToBook(await findBookRow(c, id)), 201);
});

bookRoutes.patch('/:id', requireAdmin, async (c) => {
  const body = BookPatch.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw new HTTPException(400, { message: 'Invalid book patch' });
  const book = await findBookRow(c, c.req.param('id'));
  const COLS: Record<string, string> = {
    title: 'title', author: 'author', series: 'series', description: 'description', publisher: 'publisher',
    publishedYear: 'published_year', pages: 'pages', language: 'language', isbn: 'isbn', genres: 'genres', toc: 'toc'
  };
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(body.data)) {
    if (v === undefined || !COLS[k]) continue;
    vals.push(k === 'genres' || k === 'toc' ? JSON.stringify(v) : v);
    sets.push(`${COLS[k]} = ?${vals.length}`);
  }
  if (sets.length) {
    vals.push(book.id);
    await c.env.DB.prepare(`UPDATE books SET ${sets.join(', ')} WHERE id = ?${vals.length}`).bind(...vals).run();
  }
  return c.json(rowToBook(await findBookRow(c, book.id)));
});

// Raw image body → R2 (covers extracted from EPUBs in the browser, or scanned later).
bookRoutes.put('/:id/cover', requireAdmin, async (c) => {
  if (!c.env.FILES) throw new HTTPException(501, { message: 'File storage (R2) is not configured' });
  const type = c.req.header('Content-Type') ?? '';
  if (!/^image\/(jpeg|png|webp)$/.test(type)) throw new HTTPException(415, { message: 'Cover must be JPEG, PNG or WebP' });
  if (Number(c.req.header('Content-Length') ?? 0) > 5 * 1024 * 1024) throw new HTTPException(413, { message: 'Cover is larger than 5 MB' });
  const book = await findBookRow(c, c.req.param('id'));
  const key = `covers/${book.id}`;
  await c.env.FILES.put(key, c.req.raw.body, { httpMetadata: { contentType: type } });
  await c.env.DB.prepare('UPDATE books SET cover_key = ?1 WHERE id = ?2').bind(key, book.id).run();
  return c.json(rowToBook(await findBookRow(c, book.id)));
});

const FILE_TYPES: Record<string, { format: 'pdf' | 'epub'; ext: string }> = {
  'application/pdf': { format: 'pdf', ext: 'pdf' },
  'application/epub+zip': { format: 'epub', ext: 'epub' }
};
const MAX_FILE_BYTES = 100 * 1024 * 1024; // Workers request-body limit (Free/Pro)

/**
 * Replace a book's file (e.g. after editing a PDF's metadata/chapters in the browser), or attach one to a
 * book that has none. Replacing requires `If-Match: <etag from GET …/file>`: if somebody else changed the
 * file in the meantime the write is refused (412) instead of silently overwriting their work.
 */
bookRoutes.put('/:id/file', requireAdmin, async (c) => {
  if (!c.env.FILES) throw new HTTPException(501, { message: 'File storage (R2) is not configured' });
  const type = (c.req.header('Content-Type') ?? '').split(';')[0]!.trim().toLowerCase();
  const kind = FILE_TYPES[type];
  if (!kind) throw new HTTPException(415, { message: 'Send the file as application/pdf or application/epub+zip' });
  const length = Number(c.req.header('Content-Length') ?? 0);
  if (!length) throw new HTTPException(411, { message: 'Content-Length required' });
  if (length > MAX_FILE_BYTES) throw new HTTPException(413, { message: 'File is larger than 100 MB (Workers request limit)' });

  const book = await findBookRow(c, c.req.param('id'));
  const headers = { httpMetadata: { contentType: type } };

  if (book.file_key) {
    if (kind.format !== book.format) throw new HTTPException(415, { message: `This book is a ${book.format.toUpperCase()}; send a ${book.format.toUpperCase()} file` });
    const ifMatch = (c.req.header('If-Match') ?? '').replace(/^W\//, '').replace(/"/g, '');
    if (!ifMatch) throw new HTTPException(428, { message: 'If-Match header (the file’s ETag) is required when replacing a file' });
    const stored = await c.env.FILES.put(book.file_key, c.req.raw.body, { ...headers, onlyIf: { etagMatches: ifMatch } });
    if (!stored) throw new HTTPException(412, { message: 'The file changed since you opened it. Reload and try again.' });
    return new Response(JSON.stringify(rowToBook(await findBookRow(c, book.id))), { headers: { 'content-type': 'application/json', etag: stored.httpEtag } });
  }

  // Attach to a record that has no file yet.
  const key = `${FILES_ROOT}${book.slug}.${kind.ext}`;
  if (await c.env.FILES.head(key)) throw new HTTPException(409, { message: 'A file already exists at the default path for this book' });
  const stored = await c.env.FILES.put(key, c.req.raw.body, headers);
  await c.env.DB.prepare('UPDATE books SET file_key = ?1, format = ?2 WHERE id = ?3').bind(key, kind.format, book.id).run();
  return new Response(JSON.stringify(rowToBook(await findBookRow(c, book.id))), { status: 201, headers: { 'content-type': 'application/json', etag: stored.httpEtag } });
});

bookRoutes.delete('/:id', requireAdmin, async (c) => {
  const book = await findBookRow(c, c.req.param('id'));
  await c.env.DB.prepare('DELETE FROM books WHERE id = ?1').bind(book.id).run();
  if (c.env.FILES && book.cover_key) await c.env.FILES.delete(book.cover_key);
  return c.body(null, 204);
});
