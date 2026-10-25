CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_hash TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  subscribed_at TEXT NOT NULL DEFAULT (datetime('now')),
  unsubscribe_token TEXT NOT NULL UNIQUE,
  region TEXT NOT NULL CHECK(region IN ('us','eu')),
  confirmed INTEGER NOT NULL DEFAULT 0 CHECK(confirmed IN (0,1)),
  confirmed_at TEXT,
  UNIQUE (email_hash, language)
);

CREATE INDEX IF NOT EXISTS idx_subscribers_email_hash
  ON subscribers(email_hash);
