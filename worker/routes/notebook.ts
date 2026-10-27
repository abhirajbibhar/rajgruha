/**
 * Notebook routes.
 *
 * The markdown file is the source of truth and the API accepts it verbatim, so
 * anything that can write text can write a notebook page. A structured patch
 * (`todos`, `remarks`, `reflections`) is also accepted and is merged into the
 * markdown server-side, which keeps the parsing rules in one place.
 */
import { Hono } from 'hono';
import { requireUser } from '../auth';
import type { AppEnv } from '../env';
import { asIsoDate, asIsoWeek, asString, readJson } from '../lib/http';
import { applyDayPatch, computeStreak, emptyNotebookDay, isoWeekOf, parseDay } from '../lib/notebook';
import { getNotebookDay, getNotebookWeek, listNotebookDates, putNotebookDay } from '../lib/repo';
import type { NotebookTodo } from '../lib/types';

export const notebookRoutes = new Hono<AppEnv>();

const MAX_MARKDOWN_BYTES = 512 * 1024;

function parseTodosInput(value: unknown): NotebookTodo[] {
  if (!Array.isArray(value)) return [];
  const todos: NotebookTodo[] = [];
  for (const entry of value.slice(0, 500)) {
    if (typeof entry === 'string') {
      const text = entry.trim();
      if (text) todos.push({ text: text.slice(0, 500), done: false });
      continue;
    }
    if (entry && typeof entry === 'object') {
      const record = entry as Record<string, unknown>;
      const text = typeof record.text === 'string' ? record.text.trim().slice(0, 500) : '';
      if (text) todos.push({ text, done: record.done === true });
    }
  }
  return todos;
}

/** GET /api/notebook - recent activity plus the writing streak. */
notebookRoutes.get('/', requireUser(), async (c) => {
  const store = c.get('store');
  const userId = c.get('user').id;
  const today = c.req.query('date') ? asIsoDate(c.req.query('date')) : c.get('now')().toISOString().slice(0, 10);

  const dates = await listNotebookDates(store, userId);
  const weeks = [...new Set([...dates].map((date) => isoWeekOf(date)))].sort().reverse();

  return c.json({
    today,
    week: isoWeekOf(today),
    streak: computeStreak(dates, today),
    totalDays: dates.size,
    days: [...dates].sort().reverse().slice(0, 60),
    weeks: weeks.slice(0, 26),
  });
});

/** GET /api/notebook/today */
notebookRoutes.get('/today', requireUser(), async (c) => {
  const today = c.req.query('date') ? asIsoDate(c.req.query('date')) : c.get('now')().toISOString().slice(0, 10);
  const day = await getNotebookDay(c.get('store'), c.get('user').id, today);
  return c.json({ day, isEmpty: day.updatedAt === null && day.todos.length === 0 });
});

/** GET /api/notebook/day/:date */
notebookRoutes.get('/day/:date', requireUser(), async (c) => {
  const date = asIsoDate(c.req.param('date'));
  const day = await getNotebookDay(c.get('store'), c.get('user').id, date);
  return c.json({ day });
});

/**
 * PUT /api/notebook/day/:date
 *
 * Accepts `{ markdown }` for a raw save, or `{ todos, remarks, reflections }` for
 * a structured one. Both end up as markdown on disk.
 */
notebookRoutes.put('/day/:date', requireUser(), async (c) => {
  const store = c.get('store');
  const userId = c.get('user').id;
  const date = asIsoDate(c.req.param('date'));
  const body = await readJson(c.req.raw);
  const now = c.get('now')();

  const existing = await getNotebookDay(store, userId, date);
  let markdown: string;

  if (typeof body.markdown === 'string') {
    if (body.markdown.length > MAX_MARKDOWN_BYTES) {
      throw Object.assign(new Error('That day file is too large'), { status: 413 });
    }
    markdown = body.markdown;
  } else if (body.todos !== undefined || body.remarks !== undefined || body.reflections !== undefined) {
    markdown = applyDayPatch(existing.markdown, {
      ...(body.todos === undefined ? {} : { todos: parseTodosInput(body.todos) }),
      ...(body.remarks === undefined ? {} : { remarks: asString(body.remarks, 'remarks', { max: 20_000, required: false }) }),
      ...(body.reflections === undefined
        ? {}
        : { reflections: asString(body.reflections, 'reflections', { max: 20_000, required: false }) }),
    });
  } else {
    throw Object.assign(new Error('Send "markdown", or a structured patch with todos/remarks/reflections'), {
      status: 400,
    });
  }

  const saved = await putNotebookDay(store, userId, date, markdown);
  return c.json({ day: { ...saved, updatedAt: now.toISOString() } });
});

/** GET /api/notebook/week/:week - the seven files of one ISO week, Monday first. */
notebookRoutes.get('/week/:week', requireUser(), async (c) => {
  const week = asIsoWeek(c.req.param('week'));
  const days = await getNotebookWeek(c.get('store'), c.get('user').id, week);
  return c.json({
    week,
    days,
    written: days.filter((day) => day.updatedAt !== null || day.todos.length > 0).length,
  });
});

/** GET /api/notebook/raw/:date - the plain markdown file, for download. */
notebookRoutes.get('/raw/:date', requireUser(), async (c) => {
  const date = asIsoDate(c.req.param('date'));
  const store = c.get('store');
  const userId = c.get('user').id;
  const object = await store.get(
    (await import('../lib/keys')).keys.notebookDay(userId, isoWeekOf(date), date),
  );
  if (!object) {
    const empty = emptyNotebookDay(date);
    return new Response(empty.markdown, {
      headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `inline; filename="${date}.md"` },
    });
  }
  return new Response(await object.text(), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `inline; filename="${date}.md"` },
  });
});

export type { NotebookTodo };
