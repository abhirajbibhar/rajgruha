import { describe, expect, it } from 'vitest';
import { annotation, createTestClient, post, registerOwner, uploadBook } from './helpers';

async function signedInWithBook(title = 'The Book') {
  const client = createTestClient();
  await registerOwner(client);
  const book = await uploadBook(client, { title });
  return { client, book };
}

describe('saving annotations', () => {
  it('stores exported annotations as JSON and indexes them', async () => {
    const { client, book } = await signedInWithBook();

    const saved = await client.json<{ revision: number; count: number; indexRows: number }>(
      `/api/library/${book.id}/annotations`,
      post(
        {
          revision: 0,
          items: [
            annotation({ id: 'a1', page: 2, contents: 'worth remembering', text: 'the actual highlighted words' }),
            annotation({ id: 'a2', page: 5, type: 1, contents: 'a sticky note' }),
          ],
        },
        'PUT',
      ),
    );

    expect(saved.revision).toBe(1);
    expect(saved.count).toBe(2);
    expect(saved.indexRows).toBe(2);

    // The raw file round-trips exactly what the viewer gave us.
    const raw = await client.json<{ annotations: { annotation: { id: string; custom?: unknown } }[]; revision: number }>(
      `/api/library/${book.id}/annotations`,
    );
    expect(raw.annotations.map((item) => item.annotation.id).sort()).toEqual(['a1', 'a2']);
    expect(raw.revision).toBe(1);

    // The index records the highlight text, the comment and the kind.
    const notes = await client.json<{
      annotations: { id: string; kind: string; text: string | null; note: string | null; page: number }[];
      total: number;
    }>('/api/annotations');

    expect(notes.total).toBe(2);
    const highlight = notes.annotations.find((item) => item.id === 'a1');
    expect(highlight?.kind).toBe('highlight');
    expect(highlight?.text).toBe('the actual highlighted words');
    expect(highlight?.note).toBe('worth remembering');
    expect(highlight?.page).toBe(2);

    const sticky = notes.annotations.find((item) => item.id === 'a2');
    expect(sticky?.kind).toBe('note');
    expect(sticky?.text).toBe('a sticky note');
  });

  it('is a no-op when the same annotations are saved again', async () => {
    const { client, book } = await signedInWithBook();
    const items = [annotation({ id: 'a1', text: 'text' })];

    await client.json(`/api/library/${book.id}/annotations`, post({ revision: 0, items }, 'PUT'));
    const second = await client.json<{ revision: number; added: number; count: number }>(
      `/api/library/${book.id}/annotations`,
      post({ revision: 1, items }, 'PUT'),
    );

    expect(second.revision).toBe(2);
    expect(second.added).toBe(0);
    expect(second.count).toBe(1);
  });

  it('honours a deletion from a client that was up to date', async () => {
    const { client, book } = await signedInWithBook();
    await client.json(
      `/api/library/${book.id}/annotations`,
      post(
        { revision: 0, items: [annotation({ id: 'a1' }), annotation({ id: 'a2' })] },
        'PUT',
      ),
    );

    const result = await client.json<{ removed: number; count: number }>(
      `/api/library/${book.id}/annotations`,
      post({ revision: 1, items: [annotation({ id: 'a1' })] }, 'PUT'),
    );

    expect(result.removed).toBe(1);
    expect(result.count).toBe(1);
  });

  it('never lets a stale device delete work it has not seen', async () => {
    const { client, book } = await signedInWithBook();

    // Device A creates a highlight.
    await client.json(
      `/api/library/${book.id}/annotations`,
      post({ revision: 0, items: [annotation({ id: 'from-a' })] }, 'PUT'),
    );

    // Device B, still holding revision 0 from before, saves its own annotation
    // and knows nothing about A's. A union merge must keep both.
    const result = await client.json<{ revision: number; added: number; removed: number; count: number }>(
      `/api/library/${book.id}/annotations`,
      post({ revision: 0, items: [annotation({ id: 'from-b' })] }, 'PUT'),
    );

    expect(result.added).toBe(1);
    expect(result.removed).toBe(0);
    expect(result.count).toBe(2);

    const raw = await client.json<{ annotations: { annotation: { id: string } }[] }>(
      `/api/library/${book.id}/annotations`,
    );
    expect(raw.annotations.map((item) => item.annotation.id).sort()).toEqual(['from-a', 'from-b']);
  });

  it('keeps the newer version of an annotation edited on two devices', async () => {
    const { client, book } = await signedInWithBook();
    await client.json(
      `/api/library/${book.id}/annotations`,
      post(
        { revision: 0, items: [annotation({ id: 'a1', contents: 'original', modified: '2026-10-01T10:00:00.000Z' })] },
        'PUT',
      ),
    );

    await client.json(
      `/api/library/${book.id}/annotations`,
      post(
        { revision: 1, items: [annotation({ id: 'a1', contents: 'newer', modified: '2026-10-02T10:00:00.000Z' })] },
        'PUT',
      ),
    );

    // An older edit arriving late must not overwrite the newer one.
    await client.json(
      `/api/library/${book.id}/annotations`,
      post(
        { revision: 1, items: [annotation({ id: 'a1', contents: 'stale', modified: '2026-09-01T10:00:00.000Z' })] },
        'PUT',
      ),
    );

    const raw = await client.json<{ annotations: { annotation: { contents: string } }[] }>(
      `/api/library/${book.id}/annotations`,
    );
    expect(raw.annotations[0]?.annotation.contents).toBe('newer');
  });

  it('refuses a body that is not an array of transfer items', async () => {
    const { client, book } = await signedInWithBook();
    const response = await client.fetch(
      `/api/library/${book.id}/annotations`,
      post({ revision: 0, items: 'not-an-array' }, 'PUT'),
    );
    expect(response.status).toBe(400);
  });
});

describe('the notes and highlights view', () => {
  it('filters by book, kind, search text and markup-only', async () => {
    const { client, book } = await signedInWithBook('Alpha');
    const second = await uploadBook(client, { title: 'Beta' });

    await client.json(
      `/api/library/${book.id}/annotations`,
      post(
        {
          revision: 0,
          items: [
            annotation({ id: 'h1', page: 0, contents: 'a thought', text: 'the quick brown fox' }),
            annotation({ id: 'd1', page: 1, type: 15, contents: undefined }),
          ],
        },
        'PUT',
      ),
    );
    await client.json(
      `/api/library/${second.id}/annotations`,
      post({ revision: 0, items: [annotation({ id: 'h2', page: 3, text: 'a second book highlight' })] }, 'PUT'),
    );

    const byBook = await client.json<{ total: number }>(`/api/annotations?bookId=${second.id}`);
    expect(byBook.total).toBe(1);

    const byKind = await client.json<{ total: number }>('/api/annotations?kind=ink');
    expect(byKind.total).toBe(1);

    const bySearch = await client.json<{ total: number; annotations: { text: string }[] }>(
      '/api/annotations?q=brown%20fox',
    );
    expect(bySearch.total).toBe(1);
    expect(bySearch.annotations[0]?.text).toBe('the quick brown fox');

    const markupOnly = await client.json<{ total: number }>('/api/annotations?markupOnly=true');
    expect(markupOnly.total).toBe(2);
  });

  it('reports tallies for the filter chips', async () => {
    const { client, book } = await signedInWithBook();
    await client.json(
      `/api/library/${book.id}/annotations`,
      post(
        {
          revision: 0,
          items: [annotation({ id: 'h1', text: 'one' }), annotation({ id: 'h2', text: 'two' }), annotation({ id: 'n1', type: 1, contents: 'a note' })],
        },
        'PUT',
      ),
    );

    const stats = await client.json<{ total: number; highlights: number; notes: number; books: number }>(
      '/api/annotations/stats',
    );
    expect(stats.total).toBe(3);
    expect(stats.highlights).toBe(2);
    expect(stats.notes).toBe(1);
    expect(stats.books).toBe(1);
  });

  it('rebuilds the index from the per-book files', async () => {
    const { client, book } = await signedInWithBook();
    await client.json(
      `/api/library/${book.id}/annotations`,
      post({ revision: 0, items: [annotation({ id: 'a1', text: 'kept' })] }, 'PUT'),
    );

    const me = await client.json<{ user: { id: string } }>('/api/auth/me');
    await client.store.delete(`u/${me.user.id}/index/annotations.json`);

    const rebuilt = await client.json<{ annotations: number }>('/api/annotations/reindex', { method: 'POST' });
    expect(rebuilt.annotations).toBe(1);

    const notes = await client.json<{ total: number }>('/api/annotations');
    expect(notes.total).toBe(1);
  });

  it('drops a deleted book out of the notes index', async () => {
    const { client, book } = await signedInWithBook();
    await client.json(
      `/api/library/${book.id}/annotations`,
      post({ revision: 0, items: [annotation({ id: 'a1', text: 'gone soon' })] }, 'PUT'),
    );
    expect((await client.json<{ total: number }>('/api/annotations')).total).toBe(1);

    await client.json(`/api/library/${book.id}`, { method: 'DELETE' });
    expect((await client.json<{ total: number }>('/api/annotations')).total).toBe(0);
  });
});

describe('adding an annotation to the quote collection', () => {
  it('uses the highlighted text and keeps the note alongside it', async () => {
    const { client, book } = await signedInWithBook('Meditations');
    await client.json(
      `/api/library/${book.id}/annotations`,
      post(
        {
          revision: 0,
          items: [annotation({ id: 'h1', page: 41, contents: 'a personal remark', text: 'You have power over your mind' })],
        },
        'PUT',
      ),
    );

    const promoted = await client.json<{
      created: boolean;
      quote: { text: string; note: string; source: string; origin: { bookId: string; page: number; annotationId: string } };
    }>('/api/quotes/from-annotation', post({ bookId: book.id, annotationId: 'h1' }));

    expect(promoted.created).toBe(true);
    expect(promoted.quote.text).toBe('You have power over your mind');
    expect(promoted.quote.note).toBe('a personal remark');
    expect(promoted.quote.source).toBe('Meditations');
    expect(promoted.quote.origin.bookId).toBe(book.id);
    expect(promoted.quote.origin.page).toBe(41);
  });

  it('is idempotent, updating the quote instead of duplicating it', async () => {
    const { client, book } = await signedInWithBook();
    await client.json(
      `/api/library/${book.id}/annotations`,
      post({ revision: 0, items: [annotation({ id: 'h1', text: 'first wording' })] }, 'PUT'),
    );

    await client.json('/api/quotes/from-annotation', post({ bookId: book.id, annotationId: 'h1' }));
    const second = await client.json<{ created: boolean; quote: { text: string } }>(
      '/api/quotes/from-annotation',
      post({ bookId: book.id, annotationId: 'h1', text: 'trimmed wording' }),
    );

    expect(second.created).toBe(false);
    expect(second.quote.text).toBe('trimmed wording');

    const quotes = await client.json<{ total: number }>('/api/quotes');
    expect(quotes.total).toBe(1);
  });

  it('marks the annotation as being in the quote collection', async () => {
    const { client, book } = await signedInWithBook();
    await client.json(
      `/api/library/${book.id}/annotations`,
      post({ revision: 0, items: [annotation({ id: 'h1', text: 'words' })] }, 'PUT'),
    );

    const promoted = await client.json<{ quote: { id: string } }>(
      '/api/quotes/from-annotation',
      post({ bookId: book.id, annotationId: 'h1' }),
    );

    const notes = await client.json<{ annotations: { id: string; quoteId: string | null }[] }>('/api/annotations');
    expect(notes.annotations[0]?.quoteId).toBe(promoted.quote.id);

    // Deleting the quote unlinks it again, so the button offers to re-add.
    await client.json(`/api/quotes/${promoted.quote.id}`, { method: 'DELETE' });
    const afterDelete = await client.json<{ annotations: { quoteId: string | null }[] }>('/api/annotations');
    expect(afterDelete.annotations[0]?.quoteId).toBeNull();
  });

  it('falls back to the note when a highlight captured no text', async () => {
    const { client, book } = await signedInWithBook();
    await client.json(
      `/api/library/${book.id}/annotations`,
      post({ revision: 0, items: [annotation({ id: 'h1', contents: 'only a comment here' })] }, 'PUT'),
    );

    const promoted = await client.json<{ quote: { text: string } }>(
      '/api/quotes/from-annotation',
      post({ bookId: book.id, annotationId: 'h1' }),
    );
    expect(promoted.quote.text).toBe('only a comment here');
  });

  it('rejects an annotation that has neither text nor a note', async () => {
    const { client, book } = await signedInWithBook();
    await client.json(
      `/api/library/${book.id}/annotations`,
      post({ revision: 0, items: [annotation({ id: 'ink1', type: 15 })] }, 'PUT'),
    );

    const response = await client.fetch(
      '/api/quotes/from-annotation',
      post({ bookId: book.id, annotationId: 'ink1' }),
    );
    expect(response.status).toBe(400);
  });

  it('404s an annotation that is not in the index', async () => {
    const { client, book } = await signedInWithBook();
    const response = await client.fetch(
      '/api/quotes/from-annotation',
      post({ bookId: book.id, annotationId: 'never-existed' }),
    );
    expect(response.status).toBe(404);
  });

  it('does not leak annotations between accounts', async () => {
    const owner = createTestClient();
    await registerOwner(owner, { email: 'owner@example.com' });
    const book = await uploadBook(owner, { title: 'Private' });
    await owner.json(
      `/api/library/${book.id}/annotations`,
      post({ revision: 0, items: [annotation({ id: 'h1', text: 'secret words' })] }, 'PUT'),
    );

    // A second account on the same instance sees none of it.
    await owner.json('/api/settings/instance', post({ registrationOpen: true }, 'PUT'));
    const other = createTestClient();
    await other.json(
      '/api/auth/register',
      post({ email: 'other@example.com', name: 'Other', password: 'another-long-password' }),
    );

    expect((await other.json<{ total: number }>('/api/annotations')).total).toBe(0);
    expect((await other.json<{ books: unknown[] }>('/api/library')).books).toHaveLength(0);
    expect((await other.fetch(`/api/library/${book.id}`)).status).toBe(404);
  });
});
