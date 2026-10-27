/**
 * Temporary DOM verification: drives headless Chrome over the DevTools Protocol,
 * sets the real session cookie, visits every route and asserts on rendered text.
 * Removed after the run; it is a harness, not a deliverable.
 */
const APP = `http://127.0.0.1:${process.env.PORT ?? '8789'}`;
const CDP = 'http://127.0.0.1:9222';

// Passed in from the shell: the cookie jar lives in the Git Bash /tmp, which
// Node would resolve differently on Windows.
const session = process.env.SESSION;

if (!session) {
  console.error('No session cookie found in the jar - sign in first.');
  process.exit(1);
}

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

/**
 * Case-insensitive substring test.
 *
 * The stylesheet uppercases card titles (`text-transform`), and Chrome's
 * innerText reflects that, so rendered text does not match the source casing.
 */
function has(haystack, needle) {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/* ------------------------------------------------------------- tiny CDP client */

const target = await (async () => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const list = await (await fetch(`${CDP}/json/list`)).json();
      const page = list.find((entry) => entry.type === 'page');
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      /* Chrome may not be listening yet. */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Chrome DevTools endpoint never became available');
})();

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let nextId = 1;
const pending = new Map();
const events = new Map();

socket.addEventListener('message', (message) => {
  const payload = JSON.parse(message.data);
  if (payload.id && pending.has(payload.id)) {
    const { resolve, reject } = pending.get(payload.id);
    pending.delete(payload.id);
    if (payload.error) reject(new Error(payload.error.message));
    else resolve(payload.result);
    return;
  }
  const waiters = events.get(payload.method);
  if (waiters) {
    events.delete(payload.method);
    for (const resolve of waiters) resolve(payload.params);
  }
});

function send(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

function once(method, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const waiters = events.get(method) ?? [];
    waiters.push(resolve);
    events.set(method, waiters);
    setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeoutMs);
  });
}

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');

// Give the browser the same session the API was authenticated with.
const cookieResult = await send('Network.setCookie', {
  name: 'rajgruha_session',
  value: session,
  domain: '127.0.0.1',
  path: '/',
  httpOnly: true,
});
if (!cookieResult.success) {
  console.error('Could not set the session cookie in the browser.');
  process.exit(1);
}

let visitCounter = 0;

/**
 * Loads a route as a fresh document.
 *
 * A unique query string is appended so every visit is a full page load rather
 * than a same-document hash change - which would never fire a load event, and
 * would also not exercise deep linking the way a shared URL does.
 */
async function visit(route, settleMs = 2500) {
  visitCounter += 1;
  const url = `${APP}/?probe=${visitCounter}#${route.replace(/^#?/, '/').replace('//', '/')}`;
  try {
    const loaded = once('Page.loadEventFired');
    await send('Page.navigate', { url });
    await loaded;
    await new Promise((resolve) => setTimeout(resolve, settleMs));
    // innerText misses form values, and the notebook is built out of inputs, so
    // the rendered text and the control values are both reported.
    const result = await send('Runtime.evaluate', {
      expression: `document.body.innerText + '\\n' + [...document.querySelectorAll('input,textarea,select')].map((el) => el.value || el.placeholder || '').join('\\n')`,
      returnByValue: true,
    });
    return result.result.value ?? '';
  } catch (error) {
    console.log(`  (visit failed for ${url}: ${error.message})`);
    return '';
  }
}

/** Console errors would mean a page booted into a broken state. */
const consoleErrors = [];
socket.addEventListener('message', (message) => {
  const payload = JSON.parse(message.data);
  if (payload.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(payload.params?.exceptionDetails?.exception?.description ?? 'unknown exception');
  }
});

console.log('\n--- rendered pages in a real browser (headless Chrome, authenticated) ---');

const dashboard = await visit('#/');
check('dashboard greets the reader', /Good (morning|afternoon|evening|night)|Still up\?/.test(dashboard));
check('dashboard shows the quote of the day', has(dashboard, 'You have power over your mind'));
check('dashboard labels the quote of the day', has(dashboard, 'Quote of the day'));
check('dashboard renders library stats', has(dashboard, 'Highlights') && has(dashboard, 'Books'));
check('dashboard shows the notebook streak', has(dashboard, 'Day streak'));
check('dashboard lists the book', has(dashboard, 'Meditations'));
check("dashboard previews today's notebook", has(dashboard, 'read a chapter'));
check(
  'dashboard shows the latest highlight',
  has(dashboard, 'You have power over your mind'),
  'expected the highlight text in Latest highlights',
);

const library = await visit('#/library');
check('library page renders', has(library, 'Library'));
check('library lists the seeded book', has(library, 'Meditations'));
check('library shows the author', has(library, 'Marcus Aurelius'));
check('library offers an upload action', /Upload PDF|Add a book/.test(library));

const detail = await visit('#/library/placeholder').catch(() => '');
// Resolve the real book id, then visit its detail page.
const books = await (await fetch(`${APP}/api/library`, { headers: { cookie: `rajgruha_session=${session}` } })).json();
const bookId = books.books?.[0]?.id;
if (bookId) {
  const bookPage = await visit(`#/library/${bookId}`);
  check('book detail renders the title', has(bookPage, 'Meditations'));
  check('book detail shows annotation counts', has(bookPage, 'Annotations'));
  check('book detail lists the highlight text', has(bookPage, 'You have power over your mind'));
  check('book detail offers a read action', /Continue reading|Read/.test(bookPage));
}

const notes = await visit('#/notes');
check('notes page renders', has(notes, 'Notes') && has(notes, 'Highlights'));
check('notes page lists the highlight text', has(notes, 'You have power over your mind'));
check('notes page lists the annotation note', has(notes, 'applies to mornings'));
check('notes page offers add-to-quotes', /Add to quotes|Edit quote/.test(notes));
check('notes page shows the sticky note', has(notes, 're-read before the week starts'));

const notebook = await visit('#/notebook');
check('notebook renders', has(notebook, 'Notebook'));
check('notebook shows today\u2019s todos', has(notebook, 'finish the Rajgruha build'));
check('notebook shows the open todo', has(notebook, 'read a chapter'));
check('notebook shows the remarks', has(notebook, 'Shipped the library app today'));
check('notebook shows the seven-day week panel', /2026-W4\d/.test(notebook));
check('notebook reports saved state', /Saved|Unsaved/.test(notebook));

const quotes = await visit('#/quotes');
check('quotes page renders', has(quotes, 'Quotes'));
check('quotes page lists the promoted quote', has(quotes, 'You have power over your mind'));
check('quotes page keeps the annotation note', has(quotes, 'applies to mornings'));
check('quotes page links back to the book', has(quotes, 'Meditations'));
check('quotes page shows the tag', has(quotes, 'stoicism'));

const settings = await visit('#/settings');
check('settings page renders', has(settings, 'Settings'));
check('settings offers appearance controls', has(settings, 'Appearance'));
check('settings offers reader defaults', has(settings, 'Reading and annotations'));
check('settings offers the export action', has(settings, 'Export everything'));
check('settings shows the account section', has(settings, 'Your account'));
check('settings shows the signed-in account', has(settings, 'owner@rajgruha.test'));

check('no uncaught exceptions in the browser', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

console.log(`\n${'='.repeat(60)}`);
console.log(`PASSED: ${pass}   FAILED: ${failures.length}`);
if (failures.length) {
  console.log('\nFailures:');
  for (const failure of failures) console.log(`  - ${failure}`);
  console.log('\n--- dashboard text sample ---');
  console.log(dashboard.slice(0, 1200));
  process.exit(1);
}
console.log('Every page rendered correctly from the real Worker in a real browser.');

socket.close();
process.exit(0);
