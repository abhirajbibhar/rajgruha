-- Sessions are re-checked against the user row on every request. Bumping token_version (password change,
-- reset, "sign out everywhere") invalidates every token issued before it; deleting a user does too.
ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;

-- Acquisition requests: books the library wants to get, moved across a board.
CREATE TABLE acquisitions (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  author       TEXT,
  isbn         TEXT,
  notes        TEXT,
  status       TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'evaluating', 'ordered', 'received', 'declined')),
  priority     TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  requested_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  position     REAL NOT NULL DEFAULT 0,           -- order within a column
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_acq_status ON acquisitions (status, position);
