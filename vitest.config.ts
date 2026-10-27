import { defineConfig } from 'vitest/config';

/**
 * The API is tested in plain Node against an in-memory ObjectStore.
 *
 * @cloudflare/vitest-pool-workers only supports vitest 2.x-3.2.x, and this
 * project pins vitest 5, so instead of pinning an older test runner the suite
 * drives the real Hono handlers through `app.request()` with an injected store.
 * The Worker's own runtime is exercised separately by `wrangler dev` (see README).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    reporters: ['default'],
  },
});
