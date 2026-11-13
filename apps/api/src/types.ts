import type { User } from '@rajgruha/shared';

export type Bindings = {
  DB: D1Database;
  JWT_SECRET: string;
  /** Optional R2 bucket holding the EPUB/PDF files. */
  FILES?: R2Bucket;
  CORS_ORIGIN?: string;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: { user: User };
};
