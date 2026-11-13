// Import EPUB/PDF files from a folder.
//   pnpm import:folder -- ~/Books                 → SQL for local D1 + upload to local R2
//   pnpm import:folder -- ~/Books --remote        → production
//   pnpm import:folder -- ~/Books --dry-run       → just print what would happen
// Filenames of the form "Author - Title.epub" are split into author/title;
// anything else becomes title-only with author "Unknown".
import { readdirSync, statSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { ARGS, BUCKET, execSql, parseArgs, q, slugify, target, wrangler } from './lib.ts';

const { values, positionals } = parseArgs({
  args: ARGS,
  options: { remote: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, 'no-upload': { type: 'boolean' } },
  allowPositionals: true
});
const dir = positionals[0];
if (!dir) {
  console.error('Usage: pnpm import:folder -- <folder> [--remote] [--dry-run] [--no-upload]');
  process.exit(1);
}

function* walk(d: string): Generator<string> {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(epub|pdf)$/i.test(name)) yield p;
  }
}

const used = new Set<string>();
const sql: string[] = [];
const uploads: { key: string; file: string }[] = [];

for (const file of walk(resolve(dir))) {
  const ext = extname(file).slice(1).toLowerCase() as 'epub' | 'pdf';
  const stem = basename(file, extname(file));
  const [a, ...rest] = stem.split(' - ');
  const [author, title] = rest.length ? [a!.trim(), rest.join(' - ').trim()] : ['Unknown', stem.trim()];

  let slug = slugify(`${title}`) || 'book';
  for (let i = 2; used.has(slug); i++) slug = `${slugify(title)}-${i}`;
  used.add(slug);

  const key = `books/${slug}.${ext}`;
  uploads.push({ key, file });
  sql.push(
    `INSERT OR IGNORE INTO books (id, slug, title, author, format, genres, file_key) VALUES (${q(crypto.randomUUID())}, ${q(slug)}, ${q(title)}, ${q(author)}, ${q(ext)}, '[]', ${q(key)});`
  );
}

console.log(`Found ${sql.length} book file(s) in ${dir}.`);
if (!sql.length) process.exit(0);

execSql(sql.join('\n') + '\n', { remote: Boolean(values.remote), dryRun: Boolean(values['dry-run']) });

if (!values['no-upload']) {
  for (const u of uploads) {
    if (values['dry-run']) console.log(`# wrangler r2 object put ${BUCKET}/${u.key} --file ${u.file}`);
    else wrangler(['r2', 'object', 'put', `${BUCKET}/${u.key}`, `--file=${u.file}`, target(values)]);
  }
}
