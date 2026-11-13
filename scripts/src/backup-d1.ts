// Export the remote D1 database to backups/rajgruha-<timestamp>.sql
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ARGS, DB_NAME, REPO_ROOT, parseArgs, wrangler } from './lib.ts';

const { values } = parseArgs({ args: ARGS, options: { local: { type: 'boolean' } }, allowPositionals: true });
const dir = join(REPO_ROOT, 'backups');
mkdirSync(dir, { recursive: true });
const out = join(dir, `${DB_NAME}-${new Date().toISOString().replace(/[:.]/g, '-')}.sql`);
wrangler(['d1', 'export', DB_NAME, values.local ? '--local' : '--remote', `--output=${out}`]);
console.log(`Backup written to ${out}`);
