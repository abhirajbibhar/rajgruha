-- Rajgruha: initial schema

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE books (
  id             TEXT PRIMARY KEY,
  slug           TEXT NOT NULL UNIQUE,
  title          TEXT NOT NULL,
  author         TEXT NOT NULL,
  series         TEXT,
  description    TEXT,
  publisher      TEXT,
  published_year INTEGER,
  pages          INTEGER,
  language       TEXT NOT NULL DEFAULT 'en',
  isbn           TEXT,
  format         TEXT NOT NULL CHECK (format IN ('epub', 'pdf', 'audio')),
  genres         TEXT NOT NULL DEFAULT '[]', -- JSON array of strings
  rating         REAL NOT NULL DEFAULT 0,
  rating_count   INTEGER NOT NULL DEFAULT 0,
  cover          TEXT,
  file_key       TEXT,                       -- R2 object key
  added_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_books_added  ON books (added_at DESC);
CREATE INDEX idx_books_format ON books (format);
CREATE INDEX idx_books_author ON books (author COLLATE NOCASE);

CREATE TABLE reading_progress (
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  book_id    TEXT NOT NULL REFERENCES books (id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'reading' CHECK (status IN ('queued', 'reading', 'finished')),
  percent    REAL NOT NULL DEFAULT 0,
  location   TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, book_id)
);
CREATE INDEX idx_progress_user ON reading_progress (user_id, status, updated_at DESC);
