import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { FILES_ROOT, type FileList } from '@rajgruha/shared';
import { requireAdmin, requireAuth } from '../auth';
import { rowToBrief, type BriefRow } from '../db';
import type { AppEnv } from '../types';
import { streamObject } from './books';

export const fileRoutes = new Hono<AppEnv>();
fileRoutes.use('*', requireAuth);

const MAX_BYTES = 100 * 1024 * 1024; // Workers request body limit (Free/Pro plans)
const ALLOWED = /\.(epub|pdf)$/i;

/** Relative, slash-separated, no traversal. "Fantasy/../x.epub" → "Fantasy/x.epub". */
export const cleanPath = (p: string) =>
  p.replace(/\\/g, '/').split('/').map((s) => s.trim()).filter((s) => s && s !== '.' && s !== '..').join('/').slice(0, 400);

const bucket = (c: { env: AppEnv['Bindings'] }) => {
  if (!c.env.FILES) throw new HTTPException(501, { message: 'File storage (R2) is not configured' });
  return c.env.FILES;
};
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

// GET /api/files?prefix=Fantasy/Le%20Guin — one folder level of the library
fileRoutes.get('/', async (c) => {
  const r2 = bucket(c);
  const rel = cleanPath(c.req.query('prefix') ?? '');
  const prefix = FILES_ROOT + (rel ? `${rel}/` : '');

  const listing = await r2.list({ prefix, delimiter: '/', limit: 1000 });
  const { results } = await c.env.DB.prepare(
    `SELECT id, slug, title, author, cover, cover_key, format, file_key FROM books WHERE file_key LIKE ?1 ESCAPE '\\'`
  ).bind(`${likeEscape(prefix)}%`).all<BriefRow & { file_key: string }>();
  const byKey = new Map(results.map((b) => [b.file_key, b]));

  const body: FileList = {
    prefix: rel,
    folders: listing.delimitedPrefixes.map((p) => ({ name: p.slice(prefix.length, -1), prefix: p.slice(FILES_ROOT.length, -1) })),
    files: listing.objects.map((o) => {
      const book = byKey.get(o.key);
      return { key: o.key, name: o.key.slice(prefix.length), size: o.size, uploaded: o.uploaded.toISOString(), book: book ? rowToBrief(book) : null };
    })
  };
  return c.json(body);
});

// POST /api/files/upload?path=Fantasy/Le%20Guin/The%20Dispossessed.epub[&overwrite=1]  (raw file body)
fileRoutes.post('/upload', requireAdmin, async (c) => {
  const r2 = bucket(c);
  const path = cleanPath(c.req.query('path') ?? '');
  if (!path || !ALLOWED.test(path)) throw new HTTPException(400, { message: 'Only .epub and .pdf files can be uploaded' });
  const length = Number(c.req.header('Content-Length') ?? 0);
  if (!length) throw new HTTPException(411, { message: 'Content-Length required' });
  if (length > MAX_BYTES) throw new HTTPException(413, { message: 'File is larger than 100 MB (Workers request limit)' });

  const key = FILES_ROOT + path;
  if (c.req.query('overwrite') !== '1' && (await r2.head(key))) throw new HTTPException(409, { message: 'A file already exists at that path' });
  await r2.put(key, c.req.raw.body, { httpMetadata: { contentType: /\.pdf$/i.test(path) ? 'application/pdf' : 'application/epub+zip' } });
  return c.json({ key, size: length }, 201);
});

// GET /api/files/raw?key=library/…[&download=1]
fileRoutes.get('/raw', async (c) => {
  const key = c.req.query('key') ?? '';
  if (!key.startsWith(FILES_ROOT) || key.includes('..')) throw new HTTPException(400, { message: 'Invalid key' });
  const res = await streamObject(c, key, /\.pdf$/i.test(key) ? 'application/pdf' : 'application/epub+zip');
  if (c.req.query('download') === '1') res.headers.set('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(key.split('/').pop() ?? 'file')}`);
  return res;
});

// DELETE /api/files?key=library/…[&deleteBook=1]
fileRoutes.delete('/', requireAdmin, async (c) => {
  const r2 = bucket(c);
  const key = c.req.query('key') ?? '';
  if (!key.startsWith(FILES_ROOT) || key.includes('..')) throw new HTTPException(400, { message: 'Invalid key' });
  await r2.delete(key);
  if (c.req.query('deleteBook') === '1') await c.env.DB.prepare('DELETE FROM books WHERE file_key = ?1').bind(key).run();
  else await c.env.DB.prepare('UPDATE books SET file_key = NULL WHERE file_key = ?1').bind(key).run();
  return c.body(null, 204);
});
