/**
 * Worker entry point.
 *
 * wrangler.jsonc points `main` here, and the same factory is used directly by
 * the test suite with an in-memory store, so the tests exercise exactly the code
 * that runs in production.
 */
import { createApp } from './app';
import type { Env } from './env';

export { createApp } from './app';
export type { Env } from './env';

const app = createApp();

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
