import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

export const REPO_ROOT = resolve(import.meta.dirname, '../..');
export const DB_NAME = 'rajgruha';
export const BUCKET = 'rajgruha-books';

/** SQL string literal (NULL for null/undefined). */
export const q = (v: string | number | null | undefined): string =>
  v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${v.replace(/'/g, "''")}'`;

export const slugify = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

export function target(args: { remote?: boolean }): '--remote' | '--local' {
  return args.remote ? '--remote' : '--local';
}

/** Run wrangler inside apps/api so it picks up wrangler.jsonc. */
export function wrangler(args: string[]): void {
  const res = spawnSync('pnpm', ['--filter', '@rajgruha/api', 'exec', 'wrangler', ...args], {
    cwd: REPO_ROOT,
    stdio: 'inherit'
  });
  if (res.status !== 0) {
    console.error(`wrangler ${args.join(' ')} failed`);
    process.exit(res.status ?? 1);
  }
}

/** Write SQL to a temp file and apply it to D1 (local by default, --remote for production). */
export function execSql(sql: string, opts: { remote?: boolean; dryRun?: boolean }): void {
  if (opts.dryRun) {
    console.log(sql);
    return;
  }
  const file = join(mkdtempSync(join(tmpdir(), 'rajgruha-')), 'script.sql');
  writeFileSync(file, sql);
  wrangler(['d1', 'execute', DB_NAME, target(opts), `--file=${file}`]);
}

/** argv without pnpm's forwarded `--`, so `pnpm seed -- --remote` really means remote. */
export const ARGS = process.argv.slice(2).filter((a) => a !== '--');

export { parseArgs };
