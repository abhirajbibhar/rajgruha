/**
 * Application assembly.
 *
 * `store` and `now` are injectable so the test suite can run these exact
 * handlers against an in-memory store and a frozen clock. Production passes
 * nothing and the real R2 binding is used.
 */
import { Hono } from 'hono';
import type { AppEnv } from './env';
import { r2Store, type ObjectStore } from './lib/store';
import { HttpError } from './lib/http';
import { authRoutes } from './routes/auth';
import { libraryRoutes } from './routes/library';
import { annotationRoutes } from './routes/annotations';
import { quoteRoutes } from './routes/quotes';
import { notebookRoutes } from './routes/notebook';
import { settingsRoutes } from './routes/settings';
import { dashboardRoutes } from './routes/dashboard';

export interface AppOptions {
  /** Storage override, used by tests. */
  store?: ObjectStore;
  /** Clock override, used by tests. */
  now?: () => Date;
}

/**
 * Content-Security-Policy tuned for a PDF engine that runs WebAssembly and may
 * spawn a worker. `wasm-unsafe-eval` and the `blob:` sources are required by
 * PDFium; without them the reader fails in a way that looks like a network error.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' blob:",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' blob: data:",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function applySecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', CSP);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  /**
   * Cross-origin isolation, without which the PDF engine cannot start.
   *
   * PDFium is built with threading, so it needs SharedArrayBuffer - and browsers
   * only expose that to a cross-origin isolated page. Verified in a real browser:
   * without these two headers `crossOriginIsolated` is false and the viewer mounts
   * but never renders. `require-corp` is safe here because Rajgruha loads nothing
   * cross-origin: the WASM is vendored, web fonts are disabled, and the stamp
   * library falls back to local assets.
   */
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');

  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/**
 * Cookie sessions are already SameSite=Lax, which blocks cross-site form posts.
 * This adds a second, independent check: a state-changing request that claims to
 * come from another origin is refused.
 */
function originAllowed(request: Request): boolean {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  const origin = request.headers.get('origin');
  if (!origin) return true; // Same-origin fetches from some clients omit Origin.
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

function errorPayload(error: unknown): { status: number; body: { error: { code: string; message: string; details?: unknown } } } {
  if (error instanceof HttpError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.status === 409 ? 'conflict' : error.status >= 500 ? 'server_error' : 'invalid_request',
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      },
    };
  }
  const shaped = error as { status?: number; message?: string };
  if (typeof shaped?.status === 'number' && shaped.status >= 400 && shaped.status < 500) {
    return { status: shaped.status, body: { error: { code: 'invalid_request', message: shaped.message ?? 'Bad request' } } };
  }
  return { status: 500, body: { error: { code: 'server_error', message: 'Something went wrong on the server' } } };
}

export function createApp(options: AppOptions = {}) {
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    c.set('store', options.store ?? r2Store(c.env.LIBRARY));
    c.set('now', options.now ?? (() => new Date()));
    c.set('requestId', crypto.randomUUID());
    await next();
  });

  app.use('*', async (c, next) => {
    if (!originAllowed(c.req.raw)) {
      return c.json({ error: { code: 'forbidden_origin', message: 'Cross-origin request refused' } }, 403);
    }
    await next();
  });

  // Registered before the routes so it wraps every response below, including the
  // static assets the app forwards to.
  app.use('*', async (c, next) => {
    await next();
    c.res = applySecurityHeaders(c.res);
  });

  app.get('/api/health', (c) => c.json({ ok: true, service: 'rajgruha', time: c.get('now')().toISOString() }));

  app.route('/api/auth', authRoutes);
  app.route('/api/library', libraryRoutes);
  app.route('/api/annotations', annotationRoutes);
  app.route('/api/quotes', quoteRoutes);
  app.route('/api/notebook', notebookRoutes);
  app.route('/api/settings', settingsRoutes);
  app.route('/api', dashboardRoutes);

  app.all('/api/*', (c) => c.json({ error: { code: 'not_found', message: 'Unknown API route' } }, 404));

  /**
   * Everything else is a static asset. With an `assets.binding` configured
   * wrangler does not serve them for us, so the Worker forwards explicitly and
   * `not_found_handling: single-page-application` turns unknown paths into
   * index.html, which is what a client-side router needs.
   */
  app.get('*', (c) => c.env.ASSETS.fetch(c.req.raw));

  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Not found' } }, 404));

  app.onError((error, c) => {
    const { status, body } = errorPayload(error);
    if (status >= 500) {
      console.error(
        JSON.stringify({
          level: 'error',
          requestId: c.get('requestId') ?? null,
          path: new URL(c.req.url).pathname,
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }),
      );
    }
    return c.json(body, status as 400);
  });

  return app;
}
