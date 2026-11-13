# Rajgruha

Digital library app on Cloudflare. pnpm monorepo (Node 22+, pnpm 12):

| Package | What |
|---|---|
| `apps/web` | TanStack Start + React 19 on a **Cloudflare Worker**. Styled with the Gentelella v4 design system (`src/styles/`); no Bootstrap. |
| `apps/api` | Hono Worker · D1 (SQLite) · R2 (book files, covers) · jose JWT in an HttpOnly cookie. **Private** — reachable only through the web Worker. |
| `packages/shared` | Zod schemas/types shared by web + api, PBKDF2 password hashing. |
| `scripts` | `bootstrap-admin`, `purge-demo`, `import:folder`, `import:calibre`, `backup:d1`. |

## Real data only

There is no sample or placeholder data in the app: a new library is empty and guides you to add books. If you ran an older version that seeded demo content, remove it with `pnpm purge-demo` (add `-- --remote` for the live database) — it deletes only rows with the demo id prefixes, never your own.

Everything you see is backed by the database: **Members** (accounts, roles, password resets), **Acquisitions** (the request board), **Profile**, **Settings** (theme, exports) and **Help**.

## Local development

```bash
pnpm install
echo "JWT_SECRET=$(openssl rand -hex 32)" > apps/api/.dev.vars     # PowerShell: see the end of this file
pnpm db:migrate:local
pnpm bootstrap-admin -- --email you@example.com --name "You" --password 'at-least-10-chars'
pnpm dev             # web :3000, api :8787 (Vite proxies /api → :8787)
```

## Deploying to Cloudflare

Needs a Cloudflare account (R2 must be enabled on it) and `pnpm exec wrangler login` once.

```bash
cd apps/api
pnpm exec wrangler d1 create rajgruha                  # → copy "database_id" into apps/api/wrangler.jsonc
pnpm exec wrangler r2 bucket create rajgruha-books
cd ../..
pnpm deploy:api                                        # the web Worker's service binding needs this to exist first
cd apps/api && pnpm exec wrangler secret put JWT_SECRET && cd ../..   # paste a long random string
pnpm db:migrate:remote
pnpm bootstrap-admin -- --email you@example.com --name "You" --password '…' --remote
pnpm deploy:web                                        # builds, then deploys; prints your *.workers.dev URL
```

How it fits together: the browser only ever talks to **`rajgruha-web`**. That Worker serves the app and forwards `/api/*` to **`rajgruha-api`** through a service binding (`apps/web/src/server.ts`), so the session cookie is same-site and the API has no public URL (`workers_dev: false`). Optional custom domain: uncomment `routes` in `apps/web/wrangler.jsonc`.

Check the production build locally in workerd (Cloudflare's runtime) before deploying: `pnpm preview:cf` → http://localhost:8788.

## PDF metadata & chapters live in the file

For PDFs, **Edit details & chapters** (admin) reads the title, author, description, genres, publisher, year, ISBN, language, series and the **outline (chapters)** from the PDF itself with EmbedPDF's PDFium, lets you edit them, and writes them back **into the PDF** (standard Info dictionary + bookmarks, so any reader sees them). The file in R2 is then replaced; the catalog (D1) only mirrors it for search and can be rebuilt from the file at any time (“Update catalog from file”).

- Safe saves: the new bytes are re-read and compared before upload; the upload uses the file's ETag so a concurrent edit is refused (HTTP 412) instead of overwritten.
- PDFs with no outline get one: add chapters one by one, or paste a contents list (“Intro … 3 / ␣␣Part A … 5”, with a page offset for printed-vs-PDF numbering).
- A PDF with no document-info section gets one added (standard PDF incremental update); its Producer is then `Rajgruha`.
- Password-protected PDFs can't be edited. EPUB details are catalog-only (not rewritten in the file).

## Features

Overview · Catalog (filters built from your actual genres/formats) · Reading log (calendar + sessions + notes/tasks) · Reading analytics · Books (server-side table) · **Add books** (files and whole folders → R2 with folder structure kept; EPUB/PDF metadata, chapters, cover read in the browser; ISBN scan via camera or manual + Open Library) · Book files (R2 browser) · **Acquisitions** (members request books; admins drag them through Requested → Evaluating → Ordered → Received, then “Add to catalog” pre-fills the add form) · **Members** (admin: add, change role, reset password, remove — takes effect immediately) · **Profile** (name, password, sign out everywhere) · **Settings** (theme, download your data as JSON, catalog CSV for admins; mobile section dropdown) · **Help**.
Readers (EPUB, PDF) follow light/dark; PDF opens at a chapter's page and tracks progress; reading time is recorded for the log and analytics. Shortcuts: `?` · `/` · `T` · `G` then `O/C/L/A/B/U/F`.

## Accounts & security

- Accounts are created by an administrator (Members page); the first admin comes from `pnpm bootstrap-admin`. Passwords are ≥ 10 characters, hashed with PBKDF2.
- A session proves who you are; your name and role are read from the database on every request, so removing a member, changing a role or resetting a password applies at once. Changing your own password or “Sign out everywhere” ends your other sessions.
- Members can read, log, and request books; only administrators add or edit books, files, members, and run the acquisitions board. A member can edit or withdraw their own request until it is moved.
- Exports: your own data (JSON) for everyone; catalog CSV for admins (cells starting with `= + - @` are neutralised against spreadsheet formula injection).

## Importing an existing library

- **Calibre:** `pnpm import:calibre -- "<library folder>"` brings each book's EPUB/PDF, metadata, tags and **cover**. Use `--dry-run` first.
- **A folder of files:** `pnpm import:folder -- <folder>`, or use **Add books** in the app (also reads EPUB chapters and covers).
- Back up the database any time with `pnpm backup:d1`.

## Limits & notes

- 100 MB per uploaded file (Workers request-body limit).
- Login hashes with PBKDF2 (100k iterations). The Workers **Free** plan allows 10 ms CPU per request, which that can exceed — use the **Paid** plan (or lower the iteration count in `packages/shared/src/password.ts`, at the cost of strength).
- Consider a Cloudflare WAF rate-limiting rule on `/api/auth/login`.
- pnpm 12 reads build-script policy from `pnpm-workspace.yaml` (`allowBuilds`).

PowerShell secret for `.dev.vars`: `"JWT_SECRET=$([guid]::NewGuid().ToString('N'))$([guid]::NewGuid().ToString('N'))" | Out-File -Encoding ascii apps/api/.dev.vars`
