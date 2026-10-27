/**
 * Test harness.
 *
 * Drives the real Hono app - the same handlers that run in the Worker - against
 * an in-memory ObjectStore and a frozen clock, so the suite needs neither a
 * Workers runtime nor network access. The Worker's own runtime is exercised
 * separately by `wrangler dev` (see the README).
 */
import { createApp } from '../worker/app';
import { memoryStore } from '../worker/lib/store';
import type { Env } from '../worker/env';
import type { SessionUser } from '../shared/types';

export interface TestClient {
  store: ReturnType<typeof memoryStore>;
  env: Env;
  /** GET/POST/etc with the session cookie carried automatically. */
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
  /** Same, but parses the JSON body and throws on a non-2xx status. */
  json: <T = unknown>(path: string, init?: RequestInit) => Promise<T>;
  cookie: () => string | null;
  user: () => SessionUser | null;
}

export const TEST_SECRET = 'test-secret-that-is-long-enough-for-hmac-signing';

/**
 * Builds a client against a store.
 *
 * Pass an existing `store` to get a second browser sharing one instance - that
 * is how the multi-account tests stay honest instead of accidentally testing two
 * separate installs.
 */
export function createTestClient(options: { now?: () => Date; store?: ReturnType<typeof memoryStore> } = {}): TestClient {
  const store = options.store ?? memoryStore();
  const app = createApp({ store, now: options.now });

  let cookie: string | null = null;
  let currentUser: SessionUser | null = null;

  const env = {
    // The store is injected, so the R2 binding is never touched; these stand in
    // for the bindings only to satisfy the Env type.
    LIBRARY: {} as R2Bucket,
    ASSETS: { fetch: async () => new Response('not found', { status: 404 }) } as unknown as Fetcher,
    SESSION_SECRET: TEST_SECRET,
    APP_NAME: 'Rajgruha',
    UPLOAD_MAX_BYTES: String(5 * 1024 * 1024),
    // Keep password hashing fast: the policy floor is 1000 iterations.
    PBKDF2_ITERATIONS: '1000',
    COOKIE_SECURE: 'false',
  } satisfies Env;

  const fetchWithJar = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers ?? {});
    if (cookie && !headers.has('cookie')) headers.set('cookie', cookie);
    const response = await app.request(path, { ...init, headers }, env);
    const setCookie = response.headers.getSetCookie?.() ?? [];
    for (const value of setCookie) {
      const pair = value.split(';')[0] ?? '';
      if (pair.startsWith('rajgruha_session=;') || pair.endsWith('=')) cookie = null;
      else cookie = pair;
    }
    return response;
  };

  const json = async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetchWithJar(path, init);
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new Error(`${init.method ?? 'GET'} ${path} -> ${response.status}: ${text}`);
    }
    return payload as T;
  };

  return {
    store,
    env,
    fetch: fetchWithJar,
    json,
    cookie: () => cookie,
    user: () => currentUser,
  };
}

/** Registers the owner account, which also signs the client in. */
export async function registerOwner(
  client: TestClient,
  fields: { email?: string; name?: string; password?: string } = {},
): Promise<SessionUser> {
  const { user } = await client.json<{ user: SessionUser }>('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: fields.email ?? 'owner@example.com',
      name: fields.name ?? 'Owner',
      password: fields.password ?? 'a-long-enough-password',
    }),
  });
  return user;
}

export function post(body: unknown, method = 'POST'): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/** A minimal but structurally valid PDF, enough for the magic-byte check and ranges. */
export function fakePdf(marker = 'rajgruha'): File {
  const content = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /${marker} true >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`;
  return new File([content], 'the-book.pdf', { type: 'application/pdf' });
}

export async function uploadBook(
  client: TestClient,
  fields: { title?: string; author?: string; tags?: string; shelf?: string; file?: File } = {},
): Promise<{ id: string; title: string }> {
  const form = new FormData();
  form.append('file', fields.file ?? fakePdf());
  if (fields.title) form.append('title', fields.title);
  if (fields.author) form.append('author', fields.author);
  if (fields.tags) form.append('tags', fields.tags);
  if (fields.shelf) form.append('shelf', fields.shelf);

  const { book } = await client.json<{ book: { id: string; title: string } }>('/api/library', {
    method: 'POST',
    body: form,
  });
  return book;
}

/** A saved annotation in the shape EmbedPDF exports. */
export function annotation(options: {
  id: string;
  page?: number;
  type?: number;
  contents?: string;
  text?: string;
  modified?: string;
}): { annotation: Record<string, unknown> } {
  return {
    annotation: {
      id: options.id,
      type: options.type ?? 9,
      pageIndex: options.page ?? 0,
      contents: options.contents,
      strokeColor: '#ffd400',
      created: options.modified ?? '2026-10-01T10:00:00.000Z',
      modified: options.modified ?? '2026-10-01T10:00:00.000Z',
      custom: options.text ? { rajgruha: { text: options.text } } : undefined,
    },
  };
}
