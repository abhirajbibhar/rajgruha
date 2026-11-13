import { Hono } from 'hono';
import { requireAdmin, requireAuth } from '../auth';
import type { AppEnv } from '../types';

export const exportRoutes = new Hono<AppEnv>();
exportRoutes.use('*', requireAuth);

const stamp = () => new Date().toISOString().slice(0, 10);

// Everything the signed-in member has recorded: progress, reading sessions, notes and tasks.
exportRoutes.get('/me', async (c) => {
  const me = c.get('user');
  const [progress, sessions, notes] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT b.title, b.author, b.isbn, p.status, p.percent, p.location, p.updated_at FROM reading_progress p JOIN books b ON b.id = p.book_id WHERE p.user_id = ?1 ORDER BY p.updated_at DESC`).bind(me.id),
    c.env.DB.prepare(`SELECT s.day, s.started_at, s.duration_s, s.start_percent, s.end_percent, b.title, b.author FROM reading_sessions s JOIN books b ON b.id = s.book_id WHERE s.user_id = ?1 ORDER BY s.day, s.started_at`).bind(me.id),
    c.env.DB.prepare(`SELECT day, kind, text, done, created_at FROM day_notes WHERE user_id = ?1 ORDER BY day, created_at`).bind(me.id)
  ]);
  const body = JSON.stringify({ exportedAt: new Date().toISOString(), user: { name: me.name, email: me.email }, progress: progress!.results, sessions: sessions!.results, notes: notes!.results }, null, 2);
  return new Response(body, { headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="rajgruha-my-data-${stamp()}.json"`, 'cache-control': 'no-store' } });
});

// A spreadsheet-friendly copy of the catalog. Cells that start with = + - @ are neutralised so they can't run as formulas.
const cell = (v: unknown) => {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

exportRoutes.get('/catalog.csv', requireAdmin, async (c) => {
  const { results } = await c.env.DB.prepare('SELECT title, author, series, publisher, published_year, pages, language, isbn, format, genres, rating, rating_count, file_key, added_at FROM books ORDER BY title COLLATE NOCASE').all<Record<string, unknown>>();
  const cols = ['title', 'author', 'series', 'publisher', 'published_year', 'pages', 'language', 'isbn', 'format', 'genres', 'rating', 'rating_count', 'file_key', 'added_at'];
  const lines = [cols.join(','), ...results.map((r) => cols.map((k) => cell(k === 'genres' ? (JSON.parse(String(r.genres ?? '[]')) as string[]).join('; ') : r[k])).join(','))];
  return new Response('\ufeff' + lines.join('\r\n') + '\r\n', { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="rajgruha-catalog-${stamp()}.csv"`, 'cache-control': 'no-store' } });
});
