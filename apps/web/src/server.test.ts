// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// `pnpm dev` runs src/server.ts in plain Node, where `cloudflare:workers` does not exist. A top-level import
// of it crashes the dev server (every page 500s), so it must only ever be imported lazily.
describe('server entry', () => {
  const src = fs.readFileSync(path.join(__dirname, 'server.ts'), 'utf8');
  it('does not import cloudflare:workers statically', () => {
    expect(src).not.toMatch(/^\s*import[^;]*['"]cloudflare:workers['"]/m);
  });
  it('still reaches the API binding through a lazy import', () => {
    expect(src).toMatch(/await import\('cloudflare:workers'\)/);
  });
});
