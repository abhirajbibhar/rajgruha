/**
 * Temporary check: does the EmbedPDF engine actually load and initialise in a
 * real browser from our own origin (vendored WASM, no CDN)?
 */
const APP = `http://127.0.0.1:${process.env.PORT ?? '8789'}`;
const CDP = 'http://127.0.0.1:9222';
const session = process.env.SESSION;

const target = (await (await fetch(`${CDP}/json/list`)).json()).find((entry) => entry.type === 'page');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let nextId = 1;
const pending = new Map();
const events = new Map();
const exceptions = [];
const failedRequests = [];

socket.addEventListener('message', (message) => {
  const payload = JSON.parse(message.data);
  if (payload.id && pending.has(payload.id)) {
    const { resolve, reject } = pending.get(payload.id);
    pending.delete(payload.id);
    if (payload.error) reject(new Error(payload.error.message));
    else resolve(payload.result);
    return;
  }
  if (payload.method === 'Runtime.exceptionThrown') {
    exceptions.push(payload.params?.exceptionDetails?.exception?.description ?? 'exception');
  }
  if (payload.method === 'Network.loadingFailed') {
    failedRequests.push(`${payload.params?.type} ${payload.params?.errorText}`);
  }
  const waiters = events.get(payload.method);
  if (waiters) {
    events.delete(payload.method);
    for (const resolve of waiters) resolve(payload.params);
  }
});

const send = (method, params = {}) => {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
};
const once = (method, timeoutMs = 30000) =>
  new Promise((resolve, reject) => {
    const waiters = events.get(method) ?? [];
    waiters.push(resolve);
    events.set(method, waiters);
    setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), timeoutMs);
  });

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setCookie', {
  name: 'rajgruha_session',
  value: session,
  domain: '127.0.0.1',
  path: '/',
  httpOnly: true,
});

const books = await (await fetch(`${APP}/api/library`, { headers: { cookie: `rajgruha_session=${session}` } })).json();
// Prefer the known-good PDF: a hand-written file without an xref table is not a
// fair test of whether the engine can render.
const bookId = books.books?.find((book) => book.title.startsWith('Ebook'))?.id ?? books.books?.[0]?.id;
console.log(`\n--- reader engine check (book ${bookId}) ---`);

const loaded = once('Page.loadEventFired');
// A unique query string forces a full document load each run.
await send('Page.navigate', { url: `${APP}/?probe=reader-${Date.now()}#/read/${bookId}` });
await loaded;

// The engine is a 4.6 MB wasm download plus init, so give it room.
await new Promise((resolve) => setTimeout(resolve, 25000));

const diagnostics = await send('Runtime.evaluate', {
  returnByValue: true,
  expression: `(() => {
    // The snippet renders inside web components, so the DOM must be walked
    // through shadow roots to see anything at all.
    const walk = (root, visit) => {
      visit(root);
      for (const el of root.querySelectorAll('*')) {
        visit(el);
        if (el.shadowRoot) walk(el.shadowRoot, visit);
      }
    };
    let canvases = 0;
    let shadowHosts = 0;
    let nodeCount = 0;
    const text = [];
    walk(document, (node) => {
      nodeCount += 1;
      if (node.tagName === 'CANVAS') canvases += 1;
      if (node.shadowRoot) shadowHosts += 1;
      if (node !== document && node.innerText) text.push(node.innerText);
    });
    const allText = text.join(' ').replace(/\\s+/g, ' ');
    const wasm = performance.getEntriesByType('resource').filter((e) => e.name.includes('.wasm'));
    const canvasEls = [...document.querySelectorAll('*')];
    const host = canvasEls.find((el) => el.shadowRoot && el.tagName.toLowerCase().includes('embed')) ?? canvasEls.find((el) => el.shadowRoot && el.tagName !== 'HTML');
    const box = (el) => (el ? { tag: el.tagName, w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) } : null);
    return {
      container: box(document.querySelector('.reader__canvas')),
      hostBox: box(host),
      innerBox: host ? box(host.shadowRoot.querySelector('*')) : null,
      canvases,
      shadowHosts,
      nodeCount,
      stillLoading: document.body.innerText.includes('Starting the PDF engine'),
      viewerLoading: document.body.innerText.includes('Loading the viewer'),
      crashBanner: document.body.innerText.includes('Could not open this book') || document.body.innerText.includes('This page hit a problem'),
      bodyText: document.body.innerText.slice(0, 200),
      deepText: allText.slice(0, 900),
      wasmRequests: wasm.map((e) => e.name.split('/').pop()),
      pageCount: (allText.match(/Page \\d+ of (\\d+)/) || [])[1] || null,
    };
  })()`,
});

const d = diagnostics.result.value;
console.log(JSON.stringify(d, null, 2));
console.log('\n--- exceptions ---');
console.log(exceptions.length ? exceptions.slice(0, 5).join('\n') : '(none)');
console.log('--- failed network requests ---');
console.log(failedRequests.length ? failedRequests.slice(0, 8).join('\n') : '(none)');

socket.close();
process.exit(0);
