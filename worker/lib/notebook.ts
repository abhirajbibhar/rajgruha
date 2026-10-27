/**
 * Notebook day files.
 *
 * One markdown file per day inside a per-ISO-week folder:
 *
 *   u/<userId>/notebook/2026-W44/2026-10-27.md
 *
 * The .md text is the single source of truth. The structured todos/remarks the
 * UI needs are parsed out of it on read, never stored separately, so the file
 * stays hand-editable in any editor and can never disagree with the app.
 */
import type { NotebookDay, NotebookTodo } from './types';
import { escapeMarkdown } from './http';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const TODO_LINE = /^\s*[-*]\s*\[( |x|X)\]\s*(.*)$/;

export const NOTEBOOK_SECTIONS = ['Todos', 'Remarks', 'Reflections'] as const;
export type NotebookSection = (typeof NOTEBOOK_SECTIONS)[number];

/** Returns the ISO-8601 week (`YYYY-Www`) that a calendar date falls in. */
export function isoWeekOf(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid date: ${date}`);
  // Shift to the Thursday of this week - the ISO rule that keeps week 1 correct.
  const thursday = new Date(parsed.getTime());
  const day = thursday.getUTCDay() || 7;
  thursday.setUTCDate(thursday.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** The Monday-based dates of an ISO week, oldest first. */
export function datesOfIsoWeek(week: string): string[] {
  const year = Number(week.slice(0, 4));
  const weekNumber = Number(week.slice(6));
  if (!Number.isFinite(year) || !Number.isFinite(weekNumber)) throw new Error(`Invalid week: ${week}`);

  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4.getTime() - (jan4Day - 1) * 86_400_000);
  const monday = new Date(week1Monday.getTime() + (weekNumber - 1) * 7 * 86_400_000);

  return Array.from({ length: 7 }, (_, index) =>
    new Date(monday.getTime() + index * 86_400_000).toISOString().slice(0, 10),
  );
}

export function weekdayName(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][parsed.getUTCDay()] ?? '';
}

/** The template used when a day is opened for the first time. */
export function emptyDayMarkdown(date: string): string {
  return [
    `# ${date} - ${weekdayName(date)}`,
    '',
    '## Todos',
    '',
    '- [ ] ',
    '',
    '## Remarks',
    '',
    '',
    '## Reflections',
    '',
    '',
    '',
  ].join('\n');
}

export function emptyNotebookDay(date: string, week = isoWeekOf(date)): NotebookDay {
  const markdown = emptyDayMarkdown(date);
  return {
    version: 1,
    date,
    week,
    markdown,
    todos: parseTodos(markdown),
    remarks: '',
    reflections: '',
    updatedAt: null,
  };
}

/** Pulls `- [ ]` / `- [x]` lines out of the markdown. */
export function parseTodos(markdown: string): NotebookTodo[] {
  const todos: NotebookTodo[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const match = TODO_LINE.exec(line);
    if (!match) continue;
    const text = (match[2] ?? '').trim();
    if (!text) continue;
    todos.push({ text, done: (match[1] ?? ' ').toLowerCase() === 'x' });
  }
  return todos;
}

/**
 * Splits the file into its `## Section` bodies. Content before the first
 * heading is ignored, which makes stray notes above the template harmless.
 */
export function parseSections(markdown: string): Record<string, string> {
  const sections: Record<string, string> = {};
  let current: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (current) sections[current] = buffer.join('\n').trim();
  };

  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^##\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      current = (heading[1] ?? '').trim();
      buffer = [];
      continue;
    }
    if (current) buffer.push(line);
  }
  flush();
  return sections;
}

export function parseDay(date: string, markdown: string, updatedAt: string | null): NotebookDay {
  const sections = parseSections(markdown);
  return {
    version: 1,
    date,
    week: isoWeekOf(date),
    markdown,
    todos: parseTodos(markdown),
    remarks: sections['Remarks'] ?? '',
    reflections: sections['Reflections'] ?? '',
    updatedAt,
  };
}

/** Replaces one section body, creating the heading when it is missing. */
export function replaceSection(markdown: string, section: string, body: string): string {
  const lines = markdown.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => new RegExp(`^##\\s+${section}\\s*$`, 'i').test(line));
  const newBody = body.replace(/\r?\n+$/, '').split('\n');

  if (headingIndex === -1) {
    return [...lines, '', `## ${section}`, '', ...newBody, ''].join('\n');
  }

  let end = lines.length;
  for (let i = headingIndex + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i] ?? '')) {
      end = i;
      break;
    }
  }
  const trailingBlank = end < lines.length ? [''] : [];
  return [...lines.slice(0, headingIndex + 1), '', ...newBody, ...trailingBlank, ...lines.slice(end)].join('\n');
}

/** Writes todos back into the markdown, replacing whatever list was there. */
export function replaceTodos(markdown: string, todos: NotebookTodo[]): string {
  const body = todos.map((todo) => `- [${todo.done ? 'x' : ' '}] ${escapeMarkdown(todo.text).trim()}`).join('\n');
  return replaceSection(markdown, 'Todos', body);
}

/** Merges a structured edit into the raw markdown. */
export function applyDayPatch(
  markdown: string,
  patch: { todos?: NotebookTodo[]; remarks?: string; reflections?: string },
): string {
  let next = markdown;
  if (patch.todos) next = replaceTodos(next, patch.todos);
  if (patch.remarks !== undefined) next = replaceSection(next, 'Remarks', patch.remarks);
  if (patch.reflections !== undefined) next = replaceSection(next, 'Reflections', patch.reflections);
  return next;
}

/**
 * Counts how many consecutive days up to and including `today` have a notebook
 * file. Used by the dashboard streak.
 */
export function computeStreak(datesWithContent: Set<string>, today: string, lookbackDays = 400): number {
  let streak = 0;
  const cursor = new Date(`${today}T00:00:00Z`);
  for (let i = 0; i < lookbackDays; i += 1) {
    const date = cursor.toISOString().slice(0, 10);
    if (!datesWithContent.has(date)) break;
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

export function isIsoDate(value: string): boolean {
  return ISO_DATE.test(value);
}
