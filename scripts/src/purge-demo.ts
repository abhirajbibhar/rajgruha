// Remove the sample data that older versions of this project could seed (19 demo books, fake reading history,
// demo notes). Real data is never touched: demo rows are recognised by their reserved id prefixes.
//   pnpm purge-demo                 → local D1
//   pnpm purge-demo -- --remote     → production D1
//   pnpm purge-demo -- --dry-run    → print the SQL only
import { ARGS, execSql, parseArgs } from './lib.ts';

const { values } = parseArgs({ args: ARGS, options: { remote: { type: 'boolean' }, 'dry-run': { type: 'boolean' } }, allowPositionals: true });

const sql = `
DELETE FROM reading_sessions WHERE id LIKE 'seed-s-%' OR book_id LIKE 'seed-%';
DELETE FROM reading_progress WHERE book_id LIKE 'seed-%';
DELETE FROM day_notes        WHERE id LIKE 'seed-n-%';
DELETE FROM books            WHERE id LIKE 'seed-%';
`;
execSql(sql, { remote: Boolean(values.remote), dryRun: Boolean(values['dry-run']) });
if (!values['dry-run']) console.log(`Demo data removed (${values.remote ? 'remote' : 'local'}).`);
