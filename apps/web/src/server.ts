import handler, { createServerEntry } from '@tanstack/react-start/server-entry';

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Strict-Transport-Security': 'max-age=31536000',
  'X-Robots-Tag': 'noindex' // a private library, not something for search engines
};

const secure = (res: Response) => {
  if (res.status === 101) return res;
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  return out;
};

/**
 * Production server entry (Cloudflare Workers). `/api/*` goes to the private API Worker through a service
 * binding — same origin for the browser (so the HttpOnly session cookie "just works"), no public API URL.
 * Everything else is the React app. In `pnpm dev` this file isn't used: Vite proxies /api to wrangler dev.
 */
// Loaded lazily: `cloudflare:workers` only exists inside the Workers runtime. `pnpm dev` runs this file in plain
// Node (where Vite proxies /api before we're reached), so a top-level import would crash the dev server.
const apiBinding = async () => (await import('cloudflare:workers')).env.API;

export default createServerEntry({
  async fetch(request, opts) {
    if (new URL(request.url).pathname.startsWith('/api/')) return secure(await (await apiBinding()).fetch(request));
    return secure(await handler.fetch(request, opts));
  }
});
