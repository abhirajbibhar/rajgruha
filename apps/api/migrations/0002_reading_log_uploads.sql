-- Chapters (EPUB table of contents) and R2-stored covers
ALTER TABLE books ADD COLUMN toc TEXT NOT NULL DEFAULT '[]';   -- JSON: [{label, href, level}]
ALTER TABLE books ADD COLUMN cover_key TEXT;                    -- R2 object key for an uploaded cover
CREATE UNIQUE INDEX idx_books_file_key ON books (file_key) WHERE file_key IS NOT NULL;

-- One row per reading session (client-generated id, updated by heartbeat while the reader is open).
CREATE TABLE reading_sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  book_id       TEXT NOT NULL REFERENCES books (id) ON DELETE CASCADE,
  day           TEXT NOT NULL,                 -- the reader's LOCAL date, YYYY-MM-DD
  started_at    TEXT NOT NULL,
  duration_s    INTEGER NOT NULL DEFAULT 0,
  start_percent REAL NOT NULL DEFAULT 0,
  end_percent   REAL NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_sessions_user_day  ON reading_sessions (user_id, day);
CREATE INDEX idx_sessions_user_book ON reading_sessions (user_id, book_id);

-- Per-day notes and tasks (the calendar part of the reading log).
CREATE TABLE day_notes (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day        TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note', 'task')),
  text       TEXT NOT NULL,
  done       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_notes_user_day ON day_notes (user_id, day);
