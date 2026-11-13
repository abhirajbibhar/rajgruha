import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { DayStr, MonthStr, NoteInput, NotePatch, SessionInput, type DayLog, type MonthLog, type Note } from '@rajgruha/shared';
import { requireAuth } from '../auth';
import { rowToBrief, type BriefRow } from '../db';
import type { AppEnv } from '../types';

export const logRoutes = new Hono<AppEnv>();
logRoutes.use('*', requireAuth);

const SESSION_ID = /^[\w-]{8,64}$/;
type NoteRow = { id: string; day: string; kind: 'note' | 'task'; text: string; done: number; created_at: string };
const toNote = (r: NoteRow): Note => ({ id: r.id, day: r.day, kind: r.kind, text: r.text, done: !!r.done, createdAt: r.created_at });

// Heartbeat from the reader: creates the session on first call, then only ever extends it.
logRoutes.put('/sessions/:id', async (c) => {
  const id = c.req.param('id');
  const body = SessionInput.safeParse(await c.req.json().catch(() => null));
  if (!SESSION_ID.test(id) || !body.success) throw new HTTPException(400, { message: 'Invalid session' });
  const s = body.data;
  const exists = await c.env.DB.prepare('SELECT 1 AS x FROM books WHERE id = ?1').bind(s.bookId).first();
  if (!exists) throw new HTTPException(404, { message: 'Book not found' });

  await c.env.DB.prepare(
    `INSERT INTO reading_sessions (id, user_id, book_id, day, started_at, duration_s, start_percent, end_percent)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
     ON CONFLICT (id) DO UPDATE SET
       duration_s = MAX(reading_sessions.duration_s, excluded.duration_s),
       end_percent = excluded.end_percent,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE reading_sessions.user_id = excluded.user_id`
  ).bind(id, c.get('user').id, s.bookId, s.day, s.startedAt, s.durationS, s.startPercent, s.endPercent).run();
  return c.json({ ok: true });
});

// GET /api/log/month?month=2026-11 — per-day totals for the calendar grid
logRoutes.get('/month', async (c) => {
  const month = MonthStr.safeParse(c.req.query('month'));
  if (!month.success) throw new HTTPException(400, { message: 'month must be YYYY-MM' });
  const uid = c.get('user').id;
  const from = `${month.data}-01`;
  const to = `${month.data}-31`;

  const [sessions, notes] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT day, SUM(duration_s) AS s, COUNT(*) AS n FROM reading_sessions WHERE user_id = ?1 AND day BETWEEN ?2 AND ?3 GROUP BY day').bind(uid, from, to),
    c.env.DB.prepare(`SELECT day, COUNT(*) AS n, SUM(CASE WHEN kind = 'task' AND done = 0 THEN 1 ELSE 0 END) AS open FROM day_notes WHERE user_id = ?1 AND day BETWEEN ?2 AND ?3 GROUP BY day`).bind(uid, from, to)
  ]);

  const days = new Map<string, MonthLog['days'][number]>();
  const get = (day: string) => days.get(day) ?? days.set(day, { day, minutes: 0, sessions: 0, notes: 0, tasksOpen: 0 }).get(day)!;
  for (const r of sessions!.results as { day: string; s: number; n: number }[]) Object.assign(get(r.day), { minutes: Math.round(r.s / 60), sessions: r.n });
  for (const r of notes!.results as { day: string; n: number; open: number }[]) Object.assign(get(r.day), { notes: r.n, tasksOpen: r.open ?? 0 });

  const list = [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
  const body: MonthLog = { month: month.data, totalMinutes: list.reduce((t, d) => t + d.minutes, 0), days: list };
  return c.json(body);
});

// GET /api/log/day?day=2026-11-06 — sessions + notes/tasks for one day
logRoutes.get('/day', async (c) => {
  const day = DayStr.safeParse(c.req.query('day'));
  if (!day.success) throw new HTTPException(400, { message: 'day must be YYYY-MM-DD' });
  const uid = c.get('user').id;

  const [sessions, notes] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT s.id, s.day, s.started_at, s.duration_s, s.start_percent, s.end_percent,
              b.id AS b_id, b.slug, b.title, b.author, b.cover, b.cover_key, b.format
       FROM reading_sessions s JOIN books b ON b.id = s.book_id
       WHERE s.user_id = ?1 AND s.day = ?2 ORDER BY s.started_at ASC`
    ).bind(uid, day.data),
    c.env.DB.prepare('SELECT id, day, kind, text, done, created_at FROM day_notes WHERE user_id = ?1 AND day = ?2 ORDER BY kind DESC, created_at ASC').bind(uid, day.data)
  ]);

  type SRow = BriefRow & { b_id: string; day: string; started_at: string; duration_s: number; start_percent: number; end_percent: number };
  const rows = sessions!.results as (SRow & { id: string })[];
  const body: DayLog = {
    day: day.data,
    minutes: Math.round(rows.reduce((t, r) => t + r.duration_s, 0) / 60),
    sessions: rows.map((r) => ({
      id: r.id, day: r.day, startedAt: r.started_at, durationS: r.duration_s, startPercent: r.start_percent, endPercent: r.end_percent,
      book: rowToBrief({ ...r, id: r.b_id })
    })),
    notes: (notes!.results as NoteRow[]).map(toNote)
  };
  return c.json(body);
});

// ── Notes / tasks ────────────────────────────────────────────────
logRoutes.post('/notes', async (c) => {
  const body = NoteInput.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw new HTTPException(400, { message: 'Invalid note' });
  const id = crypto.randomUUID();
  await c.env.DB.prepare('INSERT INTO day_notes (id, user_id, day, kind, text) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(id, c.get('user').id, body.data.day, body.data.kind, body.data.text).run();
  const row = await c.env.DB.prepare('SELECT id, day, kind, text, done, created_at FROM day_notes WHERE id = ?1').bind(id).first<NoteRow>();
  return c.json(toNote(row!), 201);
});

logRoutes.patch('/notes/:id', async (c) => {
  const body = NotePatch.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw new HTTPException(400, { message: 'Invalid note' });
  const uid = c.get('user').id;
  const res = await c.env.DB.prepare('UPDATE day_notes SET done = COALESCE(?1, done), text = COALESCE(?2, text) WHERE id = ?3 AND user_id = ?4')
    .bind(body.data.done === undefined ? null : Number(body.data.done), body.data.text ?? null, c.req.param('id'), uid).run();
  if (!res.meta.changes) throw new HTTPException(404, { message: 'Note not found' });
  const row = await c.env.DB.prepare('SELECT id, day, kind, text, done, created_at FROM day_notes WHERE id = ?1').bind(c.req.param('id')).first<NoteRow>();
  return c.json(toNote(row!));
});

logRoutes.delete('/notes/:id', async (c) => {
  const res = await c.env.DB.prepare('DELETE FROM day_notes WHERE id = ?1 AND user_id = ?2').bind(c.req.param('id'), c.get('user').id).run();
  if (!res.meta.changes) throw new HTTPException(404, { message: 'Note not found' });
  return c.body(null, 204);
});
