/**
 * Temporary diagnostic: capture everything the reader says in the browser console.
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
const log = [];

socket.addEventListener('message', (message) => {
  const payload = JSON.parse(message.data);
  if (payload.id && pending.has(payload.id)) {
    const { resolve, reject } = pending.get(payload.id);
    pending.delete(payload.id);
    if (payload.error) reject(new Error(payload.error.message));
    else resolve(payload.result);
    return;
  }
  if (payload.method === 'Runtime.consoleAPICalled') {
    const text = (payload.params.args ?? [])
      .map((a) => a.value ?? a.description ?? a.unserializableValue ?? a.type)
      .join(' ');
    log.push(`[${payload.params.type}] ${text}`);
  }
  if (payload.method === 'Log.entryAdded') {
    log.push(`[log:${payload.params.entry.level}] ${payload.params.entry.text}`);
  }
  if (payload.method === 'Runtime.exceptionThrown') {
    const d = payload.params.exceptionDetails;
    log.push(`[exception] ${d.exception?.description ?? d.text}`);
  }
  if (payload.method === 'Network.requestWillBeSent') {
    const url = payload.params.request.url;
    if (!url.startsWith('data:') && !url.includes('/assets/')) log.push(`[request] ${url.slice(0, 120)}`);
  }
  if (payload.method === 'Network.loadingFailed') {
    log.push(`[failed] ${payload.params.errorText} (${payload.params.type})`);
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
    setTimeout(() => reject(new Error(`timeout ${method}`)), timeoutMs);
  });

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Network.enable');
await send('Network.setCookie', { name: 'rajgruha_session', value: session, domain: '127.0.0.1', path: '/', httpOnly: true });

const books = await (await fetch(`${APP}/api/library`, { headers: { cookie: `rajgruha_session=${session}` } })).json();
const bookId = books.books?.find((book) => book.title.startsWith('Ebook'))?.id ?? books.books?.[0]?.id;
console.log(`\n--- console capture for book ${bookId} ---`);

const loaded = once('Page.loadEventFired');
await send('Page.navigate', { url: `${APP}/?probe=console-${Date.now()}#/read/${bookId}` });
await loaded;
await new Promise((resolve) => setTimeout(resolve, 25000));

const shared = await send('Runtime.evaluate', {
  returnByValue: true,
  expression: `({
    hasSharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    crossOriginIsolated: self.crossOriginIsolated,
    hasWasm: typeof WebAssembly !== 'undefined',
    sharedArrayBufferUsable: (() => { try { new SharedArrayBuffer(8); return true; } catch (e) { return false; } })(),
    workerCount: performance.getEntriesByType('resource').filter((e) => e.name.includes('worker-engine')).length,
    shadowHtml: (() => {
      const host = document.querySelector('embedpdf-container');
      return host?.shadowRoot ? host.shadowRoot.innerHTML.slice(0, 900) : 'no shadow root';
    })(),
  })`,
});

console.log('environment:', JSON.stringify(shared.result.value, null, 2).slice(0, 1200));
console.log('\n--- log ---');
console.log(log.length ? log.slice(0, 60).join('\n') : '(nothing logged)');

socket.close();
process.exit(0);
