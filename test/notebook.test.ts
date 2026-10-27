import { describe, expect, it } from 'vitest';
import { createTestClient, post, registerOwner } from './helpers';
import { parseDay, parseTodos, replaceSection, replaceTodos } from '../worker/lib/notebook';

async function signedIn(now?: () => Date) {
  const client = createTestClient({ now });
  await registerOwner(client);
  return client;
}

describe('notebook markdown handling', () => {
  it('parses todos out of the markdown, including checked ones', () => {
    const markdown = '# Heading\n\n## Todos\n\n- [ ] buy milk\n- [x] pay rent\n* [ ] starred\n- not a todo\n';
    expect(parseTodos(markdown)).toEqual([
      { text: 'buy milk', done: false },
      { text: 'pay rent', done: true },
      { text: 'starred', done: false },
    ]);
  });

  it('rewrites only the todos section', () => {
    const markdown = '## Todos\n\n- [ ] old\n\n## Remarks\n\nkeep me\n';
    const next = replaceTodos(markdown, [{ text: 'new', done: true }]);
    expect(next).toContain('- [x] new');
    expect(next).toContain('keep me');
    expect(next).not.toContain('old');
  });

  it('creates a missing section rather than dropping the edit', () => {
    const next = replaceSection('## Todos\n\n- [ ] a\n', 'Reflections', 'thoughtful');
    expect(next).toContain('## Reflections');
    expect(next).toContain('thoughtful');
  });

  it('splits a day file into its sections', () => {
    const day = parseDay('2026-10-27', '## Remarks\n\nhello\n\n## Reflections\n\nworld\n', null);
    expect(day.remarks).toBe('hello');
    expect(day.reflections).toBe('world');
    expect(day.week).toBe('2026-W44');
  });
});

describe('saving a day', () => {
  it('creates today, then saves a structured patch as markdown', async () => {
    const client = await signedIn(() => new Date('2026-10-27T09:00:00Z'));

    const first = await client.json<{ day: { markdown: string; date: string; week: string; updatedAt: string | null } }>(
      '/api/notebook/today?date=2026-10-27',
    );
    expect(first.day.date).toBe('2026-10-27');
    expect(first.day.week).toBe('2026-W44');
    expect(first.day.updatedAt).toBeNull();
    expect(first.day.markdown).toContain('## Todos');

    const saved = await client.json<{ day: { markdown: string; todos: { text: string; done: boolean }[]; remarks: string } }>(
      '/api/notebook/day/2026-10-27',
      post(
        {
          todos: [
            { text: 'read a chapter', done: false },
            { text: 'write notes', done: true },
          ],
          remarks: 'A good day.',
        },
        'PUT',
      ),
    );

    expect(saved.day.todos).toEqual([
      { text: 'read a chapter', done: false },
      { text: 'write notes', done: true },
    ]);
    expect(saved.day.remarks).toBe('A good day.');
    expect(saved.day.markdown).toContain('- [x] write notes');
  });

  it('writes one markdown file per day inside the week folder', async () => {
    const client = await signedIn();
    await client.json('/api/notebook/day/2026-10-27', post({ markdown: '# my own text\n' }, 'PUT'));

    const keys = [...client.store.snapshot().keys()];
    const dayKey = keys.find((key) => key.endsWith('.md'));
    expect(dayKey).toMatch(/notebook\/2026-W44\/2026-10-27\.md$/);

    // Raw text is stored verbatim - the file is the source of truth.
    const raw = await client.json<{ day: { markdown: string } }>('/api/notebook/day/2026-10-27');
    expect(raw.day.markdown).toBe('# my own text\n');
  });

  it('returns the seven days of a week, Monday first', async () => {
    const client = await signedIn();
    await client.json('/api/notebook/day/2026-10-27', post({ remarks: 'Tuesday' }, 'PUT'));

    const week = await client.json<{
      week: string;
      days: { date: string; remarks: string; updatedAt: string | null }[];
      written: number;
    }>('/api/notebook/week/2026-W44');

    expect(week.days).toHaveLength(7);
    expect(week.days[0]?.date).toBe('2026-10-26');
    expect(week.days[6]?.date).toBe('2026-11-01');

    const written = week.days.find((day) => day.date === '2026-10-27');
    expect(written?.remarks).toBe('Tuesday');
    // A day that exists on disk reports when it was written...
    expect(written?.updatedAt).toBeTruthy();
    // ...and a day that was never written reports nothing.
    expect(week.days.find((day) => day.date === '2026-10-28')?.updatedAt).toBeNull();
    expect(week.written).toBe(1);
  });

  it('counts a streak of consecutive days', async () => {
    const client = await signedIn(() => new Date('2026-10-27T09:00:00Z'));
    for (const date of ['2026-10-25', '2026-10-26', '2026-10-27']) {
      await client.json(`/api/notebook/day/${date}`, post({ remarks: 'written' }, 'PUT'));
    }

    const index = await client.json<{ streak: number; totalDays: number }>('/api/notebook?date=2026-10-27');
    expect(index.streak).toBe(3);
    expect(index.totalDays).toBe(3);
  });

  it('breaks the streak on a missed day', async () => {
    const client = await signedIn(() => new Date('2026-10-27T09:00:00Z'));
    await client.json('/api/notebook/day/2026-10-25', post({ remarks: 'written' }, 'PUT'));
    await client.json('/api/notebook/day/2026-10-27', post({ remarks: 'written' }, 'PUT'));

    const index = await client.json<{ streak: number }>('/api/notebook?date=2026-10-27');
    expect(index.streak).toBe(1);
  });

  it('carries yesterday\u2019s unfinished todos over without duplicating them', async () => {
    const client = await signedIn(() => new Date('2026-10-27T09:00:00Z'));
    await client.json(
      '/api/notebook/day/2026-10-26',
      post(
        {
          todos: [
            { text: 'unfinished', done: false },
            { text: 'already done', done: true },
          ],
        },
        'PUT',
      ),
    );
    await client.json('/api/notebook/day/2026-10-27', post({ todos: [{ text: 'mine today', done: false }] }, 'PUT'));

    const carried = await client.json<{ carried: number; day: { todos: { text: string }[] } }>(
      '/api/notebook/carry-over',
      post({ date: '2026-10-27' }),
    );

    expect(carried.carried).toBe(1);
    expect(carried.day.todos.map((todo) => todo.text).sort()).toEqual(['mine today', 'unfinished']);

    // Running it again changes nothing.
    const again = await client.json<{ carried: number }>('/api/notebook/carry-over', post({ date: '2026-10-27' }));
    expect(again.carried).toBe(0);
  });

  it('rejects a malformed date or a body with nothing to save', async () => {
    const client = await signedIn();
    expect((await client.fetch('/api/notebook/day/27-10-2026')).status).toBe(400);
    expect(
      (await client.fetch('/api/notebook/day/2026-10-27', post({}, 'PUT'))).status,
    ).toBe(400);
  });
});

describe('quotes', () => {
  it('creates, edits, filters and deletes a quote', async () => {
    const client = await signedIn();

    const created = await client.json<{ quote: { id: string } }>(
      '/api/quotes',
      post({ text: 'Simplicity is the ultimate sophistication', author: 'da Vinci', tags: ['design', 'craft'] }),
    );

    const listed = await client.json<{ total: number; facets: { tags: string[] } }>('/api/quotes');
    expect(listed.total).toBe(1);
    expect(listed.facets.tags.sort()).toEqual(['craft', 'design']);

    await client.json(`/api/quotes/${created.quote.id}`, post({ favorite: true, text: 'edited text' }, 'PATCH'));
    const favorites = await client.json<{ total: number; quotes: { text: string }[] }>('/api/quotes?favorite=true');
    expect(favorites.total).toBe(1);
    expect(favorites.quotes[0]?.text).toBe('edited text');

    const byTag = await client.json<{ total: number }>('/api/quotes?tag=design');
    expect(byTag.total).toBe(1);

    await client.json(`/api/quotes/${created.quote.id}`, { method: 'DELETE' });
    expect((await client.json<{ total: number }>('/api/quotes')).total).toBe(0);
  });

  it('returns the same quote of the day for a given date', async () => {
    const client = await signedIn();
    for (const text of ['one', 'two', 'three', 'four', 'five']) {
      await client.json('/api/quotes', post({ text }));
    }

    const first = await client.json<{ quote: { text: string } }>('/api/quotes/daily?date=2026-10-27');
    const second = await client.json<{ quote: { text: string } }>('/api/quotes/daily?date=2026-10-27');
    expect(first.quote.text).toBe(second.quote.text);

    // And it appears on the dashboard for the same date.
    const dashboard = await client.json<{ quoteOfTheDay: { text: string } | null }>('/api/dashboard?date=2026-10-27');
    expect(dashboard.quoteOfTheDay?.text).toBe(first.quote.text);
  });

  it('rejects an empty quote', async () => {
    const client = await signedIn();
    expect((await client.fetch('/api/quotes', post({ text: '   ' }))).status).toBe(400);
  });
});

describe('settings', () => {
  it('merges a partial patch instead of replacing everything', async () => {
    const client = await signedIn();

    await client.json('/api/settings', post({ reader: { annotationAuthor: 'Me' } }, 'PUT'));
    const after = await client.json<{ settings: { reader: { annotationAuthor: string; autosaveSeconds: number }; library: { view: string } } }>(
      '/api/settings',
    );

    expect(after.settings.reader.annotationAuthor).toBe('Me');
    // Untouched values keep their defaults, including other keys in the same group.
    expect(after.settings.reader.autosaveSeconds).toBe(20);
    expect(after.settings.library.view).toBe('grid');

    await client.json('/api/settings', post({ library: { view: 'list' } }, 'PUT'));
    const second = await client.json<{ settings: { reader: { annotationAuthor: string }; library: { view: string } } }>(
      '/api/settings',
    );
    expect(second.settings.library.view).toBe('list');
    expect(second.settings.reader.annotationAuthor).toBe('Me');
  });

  it('rejects an unknown enum value', async () => {
    const client = await signedIn();
    expect((await client.fetch('/api/settings', post({ theme: 'neon' }, 'PUT'))).status).toBe(400);
  });

  it('keeps only the owner able to change instance registration', async () => {
    const owner = createTestClient();
    await registerOwner(owner, { email: 'owner@example.com' });
    await owner.json('/api/settings/instance', post({ registrationOpen: true }, 'PUT'));

    // A second account on the same instance, not a second instance.
    const member = createTestClient({ store: owner.store });
    await member.json(
      '/api/auth/register',
      post({ email: 'member@example.com', name: 'Member', password: 'another-long-password' }),
    );

    const response = await member.fetch('/api/settings/instance', post({ registrationOpen: true }, 'PUT'));
    expect(response.status).toBe(403);
  });
});

describe('export', () => {
  it('produces a self-describing dump of everything', async () => {
    const client = await signedIn();
    await client.json('/api/quotes', post({ text: 'a quote' }));
    await client.json('/api/notebook/day/2026-10-27', post({ remarks: 'a remark' }, 'PUT'));

    const dump = await client.json<{
      format: string;
      version: number;
      books: unknown[];
      quotes: { quotes: unknown[] };
      notebook: Record<string, string>;
      settings: unknown;
    }>('/api/export');

    expect(dump.format).toBe('rajgruha-export');
    expect(dump.version).toBe(1);
    expect(dump.quotes.quotes).toHaveLength(1);
    expect(Object.keys(dump.notebook)).toContain('2026-10-27');
    expect(dump.notebook['2026-10-27']).toContain('a remark');
    expect(dump.settings).toBeTruthy();
  });
});
