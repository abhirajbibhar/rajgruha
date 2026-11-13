import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { DayStr, type Analytics } from '@rajgruha/shared';
import { requireAuth } from '../auth';
import { rowToBrief, type BriefRow } from '../db';
import type { AppEnv } from '../types';

export const analyticsRoutes = new Hono<AppEnv>();
analyticsRoutes.use('*', requireAuth);

const MS = 86_400_000;
const parseDay = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const fmtDay = (t: number) => new Date(t).toISOString().slice(0, 10);

// GET /api/analytics?days=90&today=2026-11-06   (`today` is the reader's local date)
analyticsRoutes.get('/', async (c) => {
  const today = DayStr.safeParse(c.req.query('today'));
  const days = Math.min(365, Math.max(7, Number(c.req.query('days') ?? 90) || 90));
  if (!today.success) throw new HTTPException(400, { message: 'today must be YYYY-MM-DD' });
  const uid = c.get('user').id;

  const end = parseDay(today.data);
  const from = fmtDay(end - (days - 1) * MS);
  const yearFrom = fmtDay(end - 364 * MS); // streaks look back a full year regardless of the window

  const [perDay, perBook, finished] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT day, SUM(duration_s) AS s, COUNT(*) AS n FROM reading_sessions WHERE user_id = ?1 AND day BETWEEN ?2 AND ?3 GROUP BY day').bind(uid, yearFrom, today.data),
    c.env.DB.prepare(
      `SELECT b.id, b.slug, b.title, b.author, b.cover, b.cover_key, b.format, b.genres, SUM(s.duration_s) AS s
       FROM reading_sessions s JOIN books b ON b.id = s.book_id
       WHERE s.user_id = ?1 AND s.day BETWEEN ?2 AND ?3 GROUP BY b.id ORDER BY s DESC`
    ).bind(uid, from, today.data),
    c.env.DB.prepare(`SELECT substr(updated_at, 1, 7) AS m, COUNT(*) AS n FROM reading_progress WHERE user_id = ?1 AND status = 'finished' AND updated_at >= ?2 GROUP BY m ORDER BY m`).bind(uid, `${yearFrom.slice(0, 7)}-01`)
  ]);

  const secs = new Map<string, { s: number; n: number }>();
  for (const r of perDay!.results as { day: string; s: number; n: number }[]) secs.set(r.day, { s: r.s, n: r.n });

  // Zero-filled daily series for the requested window.
  const daily: Analytics['daily'] = [];
  for (let t = end - (days - 1) * MS; t <= end; t += MS) {
    const d = fmtDay(t);
    daily.push({ day: d, minutes: Math.round(((secs.get(d)?.s ?? 0) / 60) * 10) / 10 });
  }

  // Streaks over the last year. A streak that ended yesterday is still "current" (today isn't over).
  let longest = 0;
  let run = 0;
  for (let t = end - 364 * MS; t <= end; t += MS) {
    run = (secs.get(fmtDay(t))?.s ?? 0) > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  let current = 0;
  let t = end;
  if (!secs.get(fmtDay(t))?.s) t -= MS;
  while (t >= end - 364 * MS && (secs.get(fmtDay(t))?.s ?? 0) > 0) { current++; t -= MS; }

  type BRow = BriefRow & { genres: string; s: number };
  const books = perBook!.results as BRow[];
  const byFormat = new Map<string, number>();
  const byGenre = new Map<string, number>();
  for (const b of books) {
    byFormat.set(b.format, (byFormat.get(b.format) ?? 0) + b.s);
    let genres: string[] = [];
    try { genres = JSON.parse(b.genres) as string[]; } catch { /* ignore */ }
    for (const g of genres.length ? genres : ['Uncategorised']) byGenre.set(g, (byGenre.get(g) ?? 0) + b.s / Math.max(1, genres.length));
  }
  const mins = (s: number) => Math.round(s / 60);
  const windowRows = daily.filter((d) => d.minutes > 0);
  const totalSessions = [...secs.entries()].filter(([d]) => d >= from).reduce((t2, [, v]) => t2 + v.n, 0);
  const totalMinutes = Math.round(daily.reduce((t2, d) => t2 + d.minutes, 0));
  const finishedRows = finished!.results as { m: string; n: number }[];

  const body: Analytics = {
    days,
    totals: {
      minutes: totalMinutes,
      sessions: totalSessions,
      activeDays: windowRows.length,
      avgSessionMinutes: totalSessions ? Math.round((totalMinutes / totalSessions) * 10) / 10 : 0,
      currentStreak: current,
      longestStreak: longest,
      booksFinished: finishedRows.filter((r) => r.m >= from.slice(0, 7)).reduce((t2, r) => t2 + r.n, 0)
    },
    daily,
    byFormat: [...byFormat].map(([format, s]) => ({ format, minutes: mins(s) })).sort((a, b) => b.minutes - a.minutes),
    byGenre: [...byGenre].map(([genre, s]) => ({ genre, minutes: mins(s) })).sort((a, b) => b.minutes - a.minutes).slice(0, 8),
    topBooks: books.slice(0, 5).map((b) => ({ book: rowToBrief(b), minutes: mins(b.s) })),
    finishedByMonth: finishedRows.map((r) => ({ month: r.m, count: r.n }))
  };
  return c.json(body);
});
