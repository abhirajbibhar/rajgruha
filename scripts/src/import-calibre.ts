// Import a Calibre library (reads <library>/metadata.db, read-only).
//   pnpm import:calibre -- ~/Calibre\ Library [--remote] [--dry-run] [--no-upload]
// Needs Node 22.13+ (uses the built-in node:sqlite). Imports the EPUB (or PDF), metadata, tags and each book's cover.jpg.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ARGS, BUCKET, execSql, parseArgs, q, slugify, target, wrangler } from './lib.ts';

const { values, positionals } = parseArgs({
  args: ARGS,
  options: { remote: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, 'no-upload': { type: 'boolean' } },
  allowPositionals: true
});
const lib = positionals[0] ? resolve(positionals[0]) : null;
if (!lib || !existsSync(join(lib, 'metadata.db'))) {
  console.error('Usage: pnpm import:calibre -- <calibre-library-folder>  (must contain metadata.db)');
  process.exit(1);
}

type Row = {
  id: number; title: string; path: string; pubdate: string | null; isbn: string | null;
  authors: string | null; publisher: string | null; rating: number | null; tags: string | null;
  comment: string | null; formats: string | null; has_cover: number;
};

const db = new DatabaseSync(join(lib, 'metadata.db'), { readOnly: true });
const rows = db
  .prepare(
    `SELECT b.id, b.title, b.path, b.pubdate, b.isbn, b.has_cover,
       (SELECT group_concat(a.name, ' & ') FROM authors a JOIN books_authors_link l ON l.author = a.id WHERE l.book = b.id) AS authors,
       (SELECT p.name FROM publishers p JOIN books_publishers_link l ON l.publisher = p.id WHERE l.book = b.id) AS publisher,
       (SELECT r.rating FROM ratings r JOIN books_ratings_link l ON l.rating = r.id WHERE l.book = b.id) AS rating,
       (SELECT group_concat(t.name, '|') FROM tags t JOIN books_tags_link l ON l.tag = t.id WHERE l.book = b.id) AS tags,
       (SELECT c.text FROM comments c WHERE c.book = b.id) AS comment,
       (SELECT group_concat(d.format || ':' || d.name, '|') FROM data d WHERE d.book = b.id) AS formats
     FROM books b`
  )
  .all() as Row[];

const used = new Set<string>();
const sql: string[] = [];
const uploads: { key: string; file: string; type?: string }[] = [];
let skipped = 0;

for (const r of rows) {
  const files = (r.formats ?? '').split('|').filter(Boolean).map((f) => {
    const [fmt, name] = f.split(':') as [string, string];
    return { fmt: fmt.toLowerCase(), file: join(lib, r.path, `${name}.${fmt.toLowerCase()}`) };
  });
  const chosen = files.find((f) => f.fmt === 'epub') ?? files.find((f) => f.fmt === 'pdf');
  if (!chosen) { skipped++; continue; }

  let slug = slugify(r.title) || `book-${r.id}`;
  for (let i = 2; used.has(slug); i++) slug = `${slugify(r.title)}-${i}`;
  used.add(slug);

  const key = `books/${slug}.${chosen.fmt}`;
  const id = crypto.randomUUID();
  const coverFile = join(lib, r.path, 'cover.jpg');
  const coverKey = r.has_cover && existsSync(coverFile) ? `covers/${id}` : null;
  uploads.push({ key, file: chosen.file });
  if (coverKey) uploads.push({ key: coverKey, file: coverFile, type: 'image/jpeg' });
  const year = r.pubdate ? new Date(r.pubdate).getUTCFullYear() : null;
  const isbn = r.isbn || null;
  const description = r.comment ? r.comment.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : null;
  sql.push(
    `INSERT OR IGNORE INTO books (id, slug, title, author, description, publisher, published_year, isbn, format, genres, rating, file_key, cover_key) VALUES (${[
      q(id), q(slug), q(r.title), q(r.authors ?? 'Unknown'), q(description), q(r.publisher),
      q(year && year > 1000 ? year : null), q(isbn), q(chosen.fmt), q(JSON.stringify((r.tags ?? '').split('|').filter(Boolean))),
      q((r.rating ?? 0) / 2), q(key), q(coverKey)
    ].join(', ')});`
  );
}

console.log(`Calibre: ${sql.length} importable, ${skipped} skipped (no EPUB/PDF).`);
if (!sql.length) process.exit(0);
execSql(sql.join('\n') + '\n', { remote: Boolean(values.remote), dryRun: Boolean(values['dry-run']) });

if (!values['no-upload']) {
  for (const u of uploads) {
    if (values['dry-run']) console.log(`# wrangler r2 object put ${BUCKET}/${u.key} --file ${u.file}`);
    else wrangler(['r2', 'object', 'put', `${BUCKET}/${u.key}`, `--file=${u.file}`, ...(u.type ? [`--content-type=${u.type}`] : []), target(values)]);
  }
}
