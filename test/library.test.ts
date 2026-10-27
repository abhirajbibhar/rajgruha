import { describe, expect, it } from 'vitest';
import { createTestClient, fakePdf, post, registerOwner, uploadBook } from './helpers';

async function signedIn() {
  const client = createTestClient();
  await registerOwner(client);
  return client;
}

describe('uploading', () => {
  it('stores a PDF and lists it with derived metadata', async () => {
    const client = await signedIn();
    const book = await uploadBook(client, { title: 'The Book', author: 'An Author', tags: 'one,two', shelf: 'Study' });

    expect(book.title).toBe('The Book');

    const library = await client.json<{ books: { id: string; title: string; tags: string[]; shelf: string; bytes: number }[] }>(
      '/api/library',
    );
    expect(library.books).toHaveLength(1);
    expect(library.books[0]?.tags).toEqual(['one', 'two']);
    expect(library.books[0]?.shelf).toBe('Study');
    expect(library.books[0]?.bytes).toBeGreaterThan(0);

    // The PDF is stored under the documented key.
    const keys = [...client.store.snapshot().keys()];
    expect(keys.some((key) => key.endsWith('/book.pdf'))).toBe(true);
    expect(keys.some((key) => key.endsWith('/meta.json'))).toBe(true);
  });

  it('derives a title from the file name when none is given', async () => {
    const client = await signedIn();
    const book = await uploadBook(client, { file: new File([fakePdf()], 'my_great_book.pdf', { type: 'application/pdf' }) });
    expect(book.title).toBe('my great book');
  });

  it('rejects a file that is not a PDF', async () => {
    const client = await signedIn();
    const form = new FormData();
    form.append('file', new File(['this is not a pdf'], 'notes.txt', { type: 'text/plain' }));

    const response = await client.fetch('/api/library', { method: 'POST', body: form });
    expect(response.status).toBe(400);
  });

  it('rejects an upload with no file', async () => {
    const client = await signedIn();
    const response = await client.fetch('/api/library', { method: 'POST', body: new FormData() });
    expect(response.status).toBe(400);
  });

  it('rejects a PDF over the configured size cap', async () => {
    const client = await signedIn();
    // The test env caps uploads at 5 MB.
    const big = new File([new Uint8Array(6 * 1024 * 1024)], 'big.pdf', { type: 'application/pdf' });
    const form = new FormData();
    form.append('file', big);

    const response = await client.fetch('/api/library', { method: 'POST', body: form });
    expect(response.status).toBe(413);
  });
});

describe('reading a stored book', () => {
  it('serves the bytes through a signed URL with no session cookie', async () => {
    const client = await signedIn();
    const book = await uploadBook(client);

    const detail = await client.json<{ fileUrl: string }>(`/api/library/${book.id}`);
    expect(detail.fileUrl).toContain('?t=');

    // A browser with no session at all, sharing the same instance.
    const anonymous = createTestClient({ store: client.store });
    const response = await anonymous.fetch(detail.fileUrl);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
  });

  it('answers range requests, which is how the viewer streams a big PDF', async () => {
    const client = await signedIn();
    const book = await uploadBook(client);
    const detail = await client.json<{ fileUrl: string }>(`/api/library/${book.id}`);

    const response = await client.fetch(detail.fileUrl, { headers: { range: 'bytes=0-4' } });
    expect(response.status).toBe(206);
    expect(await response.text()).toBe('%PDF-');
    expect(response.headers.get('content-range')).toMatch(/^bytes 0-4\/\d+$/);
    expect(response.headers.get('content-length')).toBe('5');
  });

  it('answers an open-ended range and a suffix range', async () => {
    const client = await signedIn();
    const book = await uploadBook(client);
    const detail = await client.json<{ fileUrl: string }>(`/api/library/${book.id}`);

    // Bytes 6 onward of "%PDF-1.4\n..." - the stream resumes mid-header, which
    // is exactly the behaviour a PDF engine relies on to seek through a file.
    const openEnded = await client.fetch(detail.fileUrl, { headers: { range: 'bytes=6-' } });
    expect(openEnded.status).toBe(206);
    expect((await openEnded.text()).startsWith('.4')).toBe(true);

    const suffix = await client.fetch(detail.fileUrl, { headers: { range: 'bytes=-10' } });
    expect(suffix.status).toBe(206);
    expect(await suffix.text()).toContain('%%EOF');
  });

  it('refuses a file token issued for another book', async () => {
    const client = await signedIn();
    const first = await uploadBook(client, { title: 'First' });
    const second = await uploadBook(client, { title: 'Second' });

    const firstDetail = await client.json<{ fileUrl: string }>(`/api/library/${first.id}`);
    const token = new URL(firstDetail.fileUrl, 'https://example.com').searchParams.get('t');

    // No session, so the mismatched token is the only credential in play.
    const anonymous = createTestClient({ store: client.store });
    const crossed = await anonymous.fetch(`/api/library/${second.id}/file?t=${token}`);
    expect(crossed.status).toBe(404);

    // The token it was actually issued for still works.
    expect((await anonymous.fetch(`/api/library/${first.id}/file?t=${token}`)).status).toBe(200);
  });

  it('404s an unknown book', async () => {
    const client = await signedIn();
    const response = await client.fetch('/api/library/does-not-exist');
    expect(response.status).toBe(404);
  });
});

describe('editing and deleting', () => {
  it('patches metadata without touching the stored bytes', async () => {
    const client = await signedIn();
    const book = await uploadBook(client, { title: 'Before' });

    const updated = await client.json<{ book: { title: string; favorite: boolean; pageCount: number } }>(
      `/api/library/${book.id}`,
      post({ title: 'After', favorite: true, pageCount: 240 }, 'PATCH'),
    );

    expect(updated.book.title).toBe('After');
    expect(updated.book.favorite).toBe(true);
    expect(updated.book.pageCount).toBe(240);

    const library = await client.json<{ books: { title: string }[] }>('/api/library');
    expect(library.books[0]?.title).toBe('After');
  });

  it('marks a book finished and back again', async () => {
    const client = await signedIn();
    const book = await uploadBook(client);

    const finished = await client.json<{ book: { finishedAt: string | null } }>(
      `/api/library/${book.id}`,
      post({ finished: true }, 'PATCH'),
    );
    expect(finished.book.finishedAt).toBeTruthy();

    const reopened = await client.json<{ book: { finishedAt: string | null } }>(
      `/api/library/${book.id}`,
      post({ finished: false }, 'PATCH'),
    );
    expect(reopened.book.finishedAt).toBeNull();
  });

  it('removes every object belonging to a deleted book', async () => {
    const client = await signedIn();
    const book = await uploadBook(client);
    const other = await uploadBook(client, { title: 'Keep me' });

    await client.json(`/api/library/${book.id}/annotations`, post({ revision: 0, items: [] }, 'PUT'));
    await client.json(
      `/api/library/${book.id}/progress`,
      post({ page: 3, pageCount: 100 }, 'PUT'),
    );
    expect([...client.store.snapshot().keys()].filter((key) => key.includes(book.id)).length).toBeGreaterThan(2);

    await client.json(`/api/library/${book.id}`, { method: 'DELETE' });

    const remaining = [...client.store.snapshot().keys()];
    expect(remaining.some((key) => key.includes(book.id))).toBe(false);
    expect(remaining.some((key) => key.includes(other.id))).toBe(true);

    const library = await client.json<{ books: { id: string }[] }>('/api/library');
    expect(library.books.map((entry) => entry.id)).toEqual([other.id]);
  });

  it('rebuilds the library index from the per-book metadata', async () => {
    const client = await signedIn();
    await uploadBook(client, { title: 'One' });
    await uploadBook(client, { title: 'Two' });

    // Simulate a lost or corrupt derived index.
    await client.store.delete('u/' + (await currentUserId(client)) + '/index/library.json');

    const rebuilt = await client.json<{ books: number }>('/api/library/reindex', { method: 'POST' });
    expect(rebuilt.books).toBe(2);

    const library = await client.json<{ books: unknown[] }>('/api/library');
    expect(library.books).toHaveLength(2);
  });
});

describe('reading progress', () => {
  it('records a position and surfaces it on the dashboard', async () => {
    const client = await signedIn();
    const book = await uploadBook(client);

    const saved = await client.json<{ progress: { page: number; percent: number; pageCount: number } }>(
      `/api/library/${book.id}/progress`,
      post({ page: 24, pageCount: 120 }, 'PUT'),
    );
    expect(saved.progress.percent).toBe(20);
    expect(saved.progress.pageCount).toBe(120);

    const dashboard = await client.json<{
      continueReading: { book: { id: string }; progress: { page: number } }[];
      stats: { inProgress: number; pagesRead: number };
    }>('/api/dashboard');

    expect(dashboard.continueReading).toHaveLength(1);
    expect(dashboard.continueReading[0]?.book.id).toBe(book.id);
    expect(dashboard.continueReading[0]?.progress.page).toBe(24);
    expect(dashboard.stats.inProgress).toBe(1);
    expect(dashboard.stats.pagesRead).toBe(24);
  });

  it('drops a finished book out of continue reading', async () => {
    const client = await signedIn();
    const book = await uploadBook(client);

    await client.json(`/api/library/${book.id}/progress`, post({ page: 118, pageCount: 120 }, 'PUT'));

    const dashboard = await client.json<{ continueReading: unknown[] }>('/api/dashboard');
    expect(dashboard.continueReading).toHaveLength(0);
  });

  it('learns the page count from the viewer', async () => {
    const client = await signedIn();
    const book = await uploadBook(client);
    await client.json(`/api/library/${book.id}/progress`, post({ page: 1, pageCount: 342 }, 'PUT'));

    const detail = await client.json<{ book: { pageCount: number } }>(`/api/library/${book.id}`);
    expect(detail.book.pageCount).toBe(342);
  });
});

/** The signed-in user's id, read out of the session record on disk. */
async function currentUserId(client: Awaited<ReturnType<typeof signedIn>>): Promise<string> {
  const me = await client.json<{ user: { id: string } }>('/api/auth/me');
  return me.user.id;
}
