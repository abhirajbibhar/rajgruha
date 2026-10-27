/**
 * Temporary end-to-end check against `wrangler dev` (real Worker, real local R2).
 * Removed after the verification run; it is a harness, not a deliverable.
 */
const BASE = `http://127.0.0.1:${process.env.PORT ?? '8787'}`;

/** A tiny but structurally valid PDF, built inline so the harness is self-contained. */
const MINI_PDF = [
  '%PDF-1.4',
  '1 0 obj',
  '<< /Type /Catalog /Pages 2 0 R >>',
  'endobj',
  '2 0 obj',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  'endobj',
  '3 0 obj',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
  'endobj',
  '4 0 obj',
  '<< /Length 46 >>',
  'stream',
  'BT /F1 14 Tf 30 150 Td (Rajgruha library) Tj ET',
  'endstream',
  'endobj',
  '5 0 obj',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  'endobj',
  'trailer',
  '<< /Root 1 0 R /Size 6 >>',
  '%%EOF',
].join('\n');
let cookie = null;
let pass = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}${detail ? ` :: ${detail}` : ''}`);
    console.log(`  FAIL ${name}${detail ? ` :: ${detail}` : ''}`);
  }
}

async function call(path, init = {}) {
  const headers = new Headers(init.headers ?? {});
  if (cookie) headers.set('cookie', cookie);
  const response = await fetch(`${BASE}${path}`, { ...init, headers, redirect: 'manual' });
  const setCookie = response.headers.getSetCookie?.() ?? [];
  for (const value of setCookie) cookie = value.split(';')[0] || cookie;
  return response;
}

async function json(path, init) {
  const response = await call(path, init);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body, headers: response.headers };
}

const payload = (value, method = 'POST') => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(value),
});

console.log('\n--- static assets (Workers Static Assets binding) ---');
{
  const index = await call('/');
  const html = await index.text();
  check('SPA index served at /', index.status === 200 && html.includes('<div id="root">'), `status ${index.status}`);
  check('CSP header present', (index.headers.get('content-security-policy') ?? '').includes('wasm-unsafe-eval'));

  const scriptPath = /src="(\/assets\/main-[^"]+\.js)"/.exec(html)?.[1];
  check('index.html references a hashed bundle', Boolean(scriptPath), scriptPath ?? 'none');
  // Content-Length is not reliable here: the assets layer may answer chunked, so
  // assert on the body instead.
  const script = await call(scriptPath ?? '/missing.js');
  const scriptBody = await script.text();
  check(
    'hashed bundle is served',
    script.status === 200 && scriptBody.length > 10000,
    `status ${script.status} bytes ${scriptBody.length}`,
  );

  const wasm = await call('/embedpdf/pdfium.wasm');
  check(
    'vendored pdfium.wasm is served from our origin',
    wasm.status === 200 && (wasm.headers.get('content-type') ?? '').includes('wasm'),
    `status ${wasm.status} type ${wasm.headers.get('content-type')}`,
  );

  const missing = await call('/api/definitely-not-a-route');
  check('unknown API route 404s as JSON', missing.status === 404);
  const spaRoute = await call('/library/some-book');
  check('deep link falls back to the SPA', spaRoute.status === 200);
}

console.log('\n--- anonymous access is refused ---');
{
  const me = await call('/api/auth/me');
  check('no session -> 401', me.status === 401);
  const status = await json('/api/auth/status');
  check('fresh instance reports no owner', status.body?.initialized === false);
  check('fresh instance has registration open', status.body?.registrationOpen === true);
}

console.log('\n--- bootstrap the owner account ---');
{
  const registered = await json(
    '/api/auth/register',
    payload({ email: 'owner@rajgruha.test', name: 'Owner', password: 'a-very-long-password' }),
  );
  check('first account registers', registered.status === 201, `status ${registered.status}`);
  check('first account is the owner', registered.body?.user?.role === 'owner');
  check('session cookie was issued', Boolean(cookie));

  const closed = await json(
    '/api/auth/register',
    payload({ email: 'other@rajgruha.test', name: 'Other', password: 'another-long-password' }),
  );
  check('registration closes after the first account', closed.status === 403, `status ${closed.status}`);
}

console.log('\n--- upload a real PDF into R2 ---');
let bookId = null;
let fileUrl = null;
{
  const form = new FormData();
  form.append('file', new File([MINI_PDF], 'rajgruha-mini.pdf', { type: 'application/pdf' }));
  form.append('title', 'Rajgruha Mini');
  form.append('author', 'Test Author');
  form.append('tags', 'test, mini');
  form.append('shelf', 'Testing');

  const uploaded = await json('/api/library', { method: 'POST', body: form });
  check(
    'upload accepted',
    uploaded.status === 201,
    `status ${uploaded.status} ${JSON.stringify(uploaded.body).slice(0, 200)}`,
  );
  bookId = uploaded.body?.book?.id;
  check('book has an id', Boolean(bookId));
  check('tags parsed from the form', JSON.stringify(uploaded.body?.book?.tags) === '["test","mini"]');

  const library = await json('/api/library');
  check('library lists the book', library.body?.books?.length === 1);

  const detail = await json(`/api/library/${bookId}`);
  fileUrl = detail.body?.fileUrl;
  check('detail returns a signed file url', typeof fileUrl === 'string' && fileUrl.includes('?t='));
}

console.log('\n--- read the bytes back with range requests ---');
{
  const full = await call(fileUrl);
  const bytes = await full.arrayBuffer();
  check('full file served', full.status === 200, `status ${full.status}`);
  check('content type is application/pdf', full.headers.get('content-type') === 'application/pdf');
  check('accept-ranges advertised', full.headers.get('accept-ranges') === 'bytes');
  check('bytes match what was uploaded', Buffer.from(bytes).subarray(0, 8).toString() === '%PDF-1.4');

  const ranged = await call(fileUrl, { headers: { range: 'bytes=0-4' } });
  check('range request returns 206', ranged.status === 206, `status ${ranged.status}`);
  check('range content is exact', (await ranged.text()) === '%PDF-');
  check(
    'content-range is well formed',
    /^bytes 0-4\/\d+$/.test(ranged.headers.get('content-range') ?? ''),
    ranged.headers.get('content-range') ?? '',
  );
  check('content-length matches the range', ranged.headers.get('content-length') === '5');

  const suffix = await call(fileUrl, { headers: { range: 'bytes=-10' } });
  check('suffix range works', suffix.status === 206 && (await suffix.text()).includes('%%EOF'));

  const openEnded = await call(fileUrl, { headers: { range: 'bytes=100-' } });
  check(
    'open-ended range works',
    openEnded.status === 206 && (openEnded.headers.get('content-length') ?? '0') !== '0',
  );
}

console.log('\n--- annotations: save, index, promote to quote ---');
const annotationItems = [
  {
    annotation: {
      id: 'e2e-highlight-1',
      type: 9,
      pageIndex: 0,
      contents: 'a note about the passage',
      strokeColor: '#ffd400',
      created: '2026-10-27T10:00:00.000Z',
      modified: '2026-10-27T10:00:00.000Z',
      custom: { rajgruha: { text: 'You have power over your mind, not outside events.' } },
    },
  },
  {
    annotation: {
      id: 'e2e-ink-1',
      type: 15,
      pageIndex: 0,
      created: '2026-10-27T10:05:00.000Z',
      modified: '2026-10-27T10:05:00.000Z',
    },
  },
];
{
  const saved = await json(
    `/api/library/${bookId}/annotations`,
    payload({ revision: 0, items: annotationItems }, 'PUT'),
  );
  check('annotations saved', saved.status === 200, `status ${saved.status}`);
  check('revision advanced to 1', saved.body?.revision === 1, String(saved.body?.revision));
  check('index was built', saved.body?.indexRows === 2, String(saved.body?.indexRows));

  const raw = await json(`/api/library/${bookId}/annotations`);
  check('raw annotations round-trip', raw.body?.annotations?.length === 2);
  const roundTripped = raw.body?.annotations?.find((item) => item.annotation.id === 'e2e-highlight-1');
  check(
    'captured highlight text survives the round trip',
    roundTripped?.annotation?.custom?.rajgruha?.text === 'You have power over your mind, not outside events.',
    JSON.stringify(roundTripped?.annotation?.custom),
  );

  const notes = await json('/api/annotations');
  check('notes index has two rows', notes.body?.total === 2, String(notes.body?.total));
  const highlight = notes.body?.annotations?.find((item) => item.id === 'e2e-highlight-1');
  check('highlight rendered as kind=highlight', highlight?.kind === 'highlight', highlight?.kind);
  check('note is indexed separately from the text', highlight?.note === 'a note about the passage');
  check('ink annotation is not markup', notes.body?.annotations?.find((i) => i.id === 'e2e-ink-1')?.kind === 'ink');

  const markupOnly = await json('/api/annotations?markupOnly=true');
  check('markup-only filter hides ink', markupOnly.body?.total === 1);

  const promoted = await json('/api/quotes/from-annotation', payload({ bookId, annotationId: 'e2e-highlight-1' }));
  check('annotation promoted to a quote', promoted.status === 201, `status ${promoted.status}`);
  check(
    'quote text is the highlighted text',
    promoted.body?.quote?.text === 'You have power over your mind, not outside events.',
  );
  check('quote keeps the annotation note', promoted.body?.quote?.note === 'a note about the passage');
  check('quote records its origin', promoted.body?.quote?.origin?.bookId === bookId);
  check('quote source is the book title', promoted.body?.quote?.source === 'Rajgruha Mini');

  const again = await json('/api/quotes/from-annotation', payload({ bookId, annotationId: 'e2e-highlight-1' }));
  check('promoting twice does not duplicate', again.status === 200 && again.body?.created === false);

  const quotes = await json('/api/quotes');
  check('quote collection has exactly one', quotes.body?.total === 1, String(quotes.body?.total));

  const linked = await json('/api/annotations');
  check(
    'annotation now shows it is in quotes',
    Boolean(linked.body?.annotations?.find((i) => i.id === 'e2e-highlight-1')?.quoteId),
  );

  const stale = await json(
    `/api/library/${bookId}/annotations`,
    payload({ revision: 0, items: [annotationItems[0]] }, 'PUT'),
  );
  check('stale save cannot delete annotations', stale.body?.removed === 0, String(stale.body?.removed));
  const stillThere = await json(`/api/library/${bookId}/annotations`);
  check('both annotations survive a stale save', stillThere.body?.annotations?.length === 2);
}

console.log('\n--- notebook: markdown per day in a week folder ---');
{
  const created = await json(
    '/api/notebook/day/2026-10-27',
    payload({ todos: [{ text: 'ship Rajgruha', done: false }], remarks: 'Built the library.' }, 'PUT'),
  );
  check('day saved', created.status === 200, `status ${created.status}`);
  check('markdown contains the todo', (created.body?.day?.markdown ?? '').includes('- [ ] ship Rajgruha'));
  check('day reports a timestamp after saving', created.body?.day?.updatedAt !== null);

  const reread = await json('/api/notebook/day/2026-10-27');
  check('day file persists', reread.body?.day?.updatedAt !== null, String(reread.body?.day?.updatedAt));
  check('remarks persist', reread.body?.day?.remarks === 'Built the library.');

  const week = await json('/api/notebook/week/2026-W44');
  check('week has seven days', week.body?.days?.length === 7, String(week.body?.days?.length));
  check('week starts on Monday', week.body?.days?.[0]?.date === '2026-10-26', week.body?.days?.[0]?.date);
  check('week counts one written day', week.body?.written === 1, String(week.body?.written));

  await json('/api/notebook/day/2026-10-28', payload({ remarks: 'Day two.' }, 'PUT'));
  const index = await json('/api/notebook?date=2026-10-28');
  check('streak counts consecutive days', index.body?.streak === 2, String(index.body?.streak));
}

console.log('\n--- reading progress and the dashboard ---');
{
  const progress = await json(`/api/library/${bookId}/progress`, payload({ page: 0, pageCount: 1 }, 'PUT'));
  check('progress saved', progress.status === 200, `status ${progress.status}`);
  check('percent computed', progress.body?.progress?.percent === 0);

  const dash = await json('/api/dashboard?date=2026-10-28');
  check('dashboard responds', dash.status === 200, `status ${dash.status}`);
  check('dashboard reports the book', dash.body?.stats?.books === 1);
  check('dashboard reports highlights', dash.body?.stats?.highlights === 1, String(dash.body?.stats?.highlights));
  check('dashboard reports one quote', dash.body?.stats?.quotes === 1);
  check('dashboard reports the notebook streak', dash.body?.stats?.streak === 2, String(dash.body?.stats?.streak));
  check('dashboard lists recent annotations', (dash.body?.recentlyAnnotated ?? []).length === 2);
  check('dashboard returns a quote of the day', dash.body?.quoteOfTheDay?.text?.startsWith('You have power'));
  check('dashboard surfaces tags', (dash.body?.tags ?? []).some((tag) => tag.name === 'test'));
}

console.log('\n--- settings, export and cleanup ---');
{
  const saved = await json('/api/settings', payload({ theme: 'dark', reader: { annotationAuthor: 'Raj' } }, 'PUT'));
  check('settings patch accepted', saved.status === 200);
  check('patched field applied', saved.body?.settings?.theme === 'dark');
  check('untouched field keeps its default', saved.body?.settings?.reader?.autosaveSeconds === 20);
  check('sibling field in the same group kept', saved.body?.settings?.reader?.annotationAuthor === 'Raj');

  const dump = await json('/api/export');
  check('export has the right format marker', dump.body?.format === 'rajgruha-export');
  check('export includes annotations', Boolean(dump.body?.annotations?.[bookId]));
  check('export includes notebook markdown', typeof dump.body?.notebook?.['2026-10-27'] === 'string');

  const reindex = await json('/api/annotations/reindex', { method: 'POST' });
  check('notes index rebuilds from source files', reindex.body?.annotations === 2, JSON.stringify(reindex.body));

  const removed = await json(`/api/library/${bookId}`, { method: 'DELETE' });
  check('book deleted', removed.status === 200);
  const orphanNotes = await json('/api/annotations');
  check(
    'deleting a book removes its annotations from the index',
    orphanNotes.body?.total === 0,
    String(orphanNotes.body?.total),
  );
  const orphanFile = await call(fileUrl);
  check('deleted book file is gone', orphanFile.status === 404, `status ${orphanFile.status}`);

  const afterQuotes = await json('/api/quotes');
  check('quotes are kept after the book is deleted', afterQuotes.body?.total === 1);
}

console.log(`\n${'='.repeat(60)}`);
console.log(`PASSED: ${pass}   FAILED: ${failures.length}`);
if (failures.length) {
  console.log('\nFailures:');
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
console.log('All end-to-end checks passed against the real Worker runtime.');
