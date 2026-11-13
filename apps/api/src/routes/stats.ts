import { Hono } from 'hono';
import type { Stats } from '@rajgruha/shared';
import { requireAuth } from '../auth';
import type { AppEnv } from '../types';

export const statsRoutes = new Hono<AppEnv>();
statsRoutes.use('*', requireAuth);

statsRoutes.get('/', async (c) => {
  const uid = c.get('user').id;
  const [formats, month, progress] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT format, COUNT(*) AS n FROM books GROUP BY format'),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM books WHERE added_at >= strftime('%Y-%m-01', 'now')`),
    c.env.DB.prepare('SELECT status, COUNT(*) AS n FROM reading_progress WHERE user_id = ?1 GROUP BY status').bind(uid)
  ]);

  const byFormat: Record<string, number> = {};
  let totalBooks = 0;
  for (const r of (formats!.results as { format: string; n: number }[])) {
    byFormat[r.format] = r.n;
    totalBooks += r.n;
  }
  const by = Object.fromEntries((progress!.results as { status: string; n: number }[]).map((r) => [r.status, r.n]));

  const stats: Stats = {
    totalBooks,
    byFormat,
    addedThisMonth: (month!.results[0] as { n: number } | undefined)?.n ?? 0,
    reading: by.reading ?? 0,
    finished: by.finished ?? 0,
    queued: by.queued ?? 0
  };
  return c.json(stats);
});
