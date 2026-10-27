/**
 * Worker bindings and the per-request context.
 *
 * Everything Rajgruha stores lives in one R2 bucket. There is no KV, no D1, no
 * queue and no cache: one dependency is one thing that can break, and JSON +
 * Markdown + PDF in a bucket is the format most likely to still be readable in
 * fifteen years.
 */
import type { ObjectStore } from './lib/store';
import type { SessionUser } from '../shared/types';

export interface Env {
  /** Binding name LIBRARY, bucket name configured in wrangler.jsonc. */
  LIBRARY: R2Bucket;
  /** Static asset binding for web/dist. */
  ASSETS: Fetcher;
  /** HMAC key for session cookies and file tokens. `wrangler secret put SESSION_SECRET`. */
  SESSION_SECRET: string;
  /** Display name, shown on the sign-in screen. */
  APP_NAME?: string;
  /** Hard cap for one PDF upload, in bytes. */
  UPLOAD_MAX_BYTES?: string;
  /** PBKDF2 work factor for new passwords. Lower it if you run on the Workers free plan. */
  PBKDF2_ITERATIONS?: string;
  /**
   * Set to "false" only when testing over plain http on a LAN address, where
   * browsers refuse to store a Secure cookie.
   */
  COOKIE_SECURE?: string;
}

export type { SessionUser } from '../shared/types';

/**
 * `store` and `now` are injected rather than read from the environment so the
 * test suite can drive the real handlers against an in-memory store and a fixed
 * clock without a Workers runtime.
 */
export interface Variables {
  store: ObjectStore;
  now: () => Date;
  user: SessionUser;
  requestId: string;
}

export type AppEnv = { Bindings: Env; Variables: Variables };
