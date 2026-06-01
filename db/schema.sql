-- ============================================================
-- sohamhamso — local-dev SQLite schema
--
-- Production architecture (see plan: check-online-websites-aim-sparkling-pearl.md):
--   3 Turso DBs — corpus / vectors / pii.
-- Local dev: single SQLite file `db/sohamhamso.db` containing the
-- same logical schema. Tables are grouped + commented with their
-- target production DB so migration is mechanical.
-- ============================================================


-- ============================================================
-- CORPUS DB (production: turso/sohamhamso-corpus)
-- ============================================================

CREATE TABLE IF NOT EXISTS texts (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title_sa TEXT NOT NULL,
  title_en TEXT NOT NULL,
  title_iast TEXT,
  author TEXT,
  tradition TEXT NOT NULL,
  school TEXT,
  era TEXT,
  source TEXT,
  source_url TEXT,
  source_revision TEXT,
  license TEXT NOT NULL,
  attribution_html TEXT,
  parent_text_id TEXT REFERENCES texts(id),
  manuscript_url TEXT,
  description TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS verses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text_id TEXT NOT NULL REFERENCES texts(id),
  book INTEGER,
  chapter INTEGER NOT NULL,
  verse_num INTEGER NOT NULL,
  devanagari TEXT NOT NULL,
  slp1 TEXT,
  iast TEXT,
  meter TEXT,
  manuscript_folio_ref TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (text_id, chapter, verse_num)
);
CREATE INDEX IF NOT EXISTS idx_verses_text ON verses(text_id);
CREATE INDEX IF NOT EXISTS idx_verses_chapter ON verses(text_id, chapter);

CREATE TABLE IF NOT EXISTS translations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  verse_id INTEGER NOT NULL REFERENCES verses(id),
  lang TEXT NOT NULL,
  translator TEXT,
  translation_text TEXT NOT NULL,
  source TEXT,
  license TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','reviewed','published')),
  ai_assisted INTEGER NOT NULL DEFAULT 0 CHECK(ai_assisted IN (0,1)),
  model TEXT,
  model_version TEXT,
  prompt_version TEXT,
  judge_score REAL,
  reviewer TEXT,
  reviewed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE (verse_id, lang, translator)
);
CREATE INDEX IF NOT EXISTS idx_translations_verse_lang ON translations(verse_id, lang);
CREATE INDEX IF NOT EXISTS idx_translations_status ON translations(status);

CREATE TABLE IF NOT EXISTS word_glosses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  verse_id INTEGER NOT NULL REFERENCES verses(id),
  word_idx INTEGER NOT NULL,
  word_sa TEXT NOT NULL,
  lemma_sa TEXT,
  lemma_iast TEXT,
  gloss_lang TEXT NOT NULL,
  gloss_text TEXT NOT NULL,
  morph TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (verse_id, word_idx, gloss_lang)
);
CREATE INDEX IF NOT EXISTS idx_glosses_verse ON word_glosses(verse_id);

CREATE TABLE IF NOT EXISTS parallels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_verse_id INTEGER NOT NULL REFERENCES verses(id),
  target_verse_id INTEGER NOT NULL REFERENCES verses(id),
  citation_type TEXT,
  confidence REAL CHECK(confidence >= 0 AND confidence <= 1),
  extracted_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (source_verse_id, target_verse_id)
);
CREATE INDEX IF NOT EXISTS idx_parallels_source ON parallels(source_verse_id);


-- ============================================================
-- VECTORS DB (production: turso/sohamhamso-vectors)
-- For local dev, embeddings live here too. Production: separate DB.
-- In libSQL prod schema, `embedding` becomes F32_BLOB(3072) with
-- a vector index. Locally we keep it as raw BLOB.
-- ============================================================

CREATE TABLE IF NOT EXISTS verse_embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  verse_id INTEGER NOT NULL,  -- application-level FK (cross-DB in prod)
  lang TEXT NOT NULL,
  embedding BLOB NOT NULL,  -- F32_BLOB(3072) in libSQL; BLOB in local SQLite
  model TEXT DEFAULT 'text-embedding-3-large',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (verse_id, lang, model)
);
CREATE INDEX IF NOT EXISTS idx_embeddings_verse ON verse_embeddings(verse_id);


-- ============================================================
-- PII DB (production: turso/sohamhamso-pii)
-- Subscribers — HMAC-SHA256(email, pepper) per eng review.
-- The pepper is loaded from SUBSCRIBER_HASH_PEPPER env at write time.
-- ============================================================

CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_hash TEXT NOT NULL UNIQUE,  -- HMAC-SHA256(email, SUBSCRIBER_HASH_PEPPER env)
  language TEXT NOT NULL DEFAULT 'en',
  subscribed_at TEXT NOT NULL DEFAULT (datetime('now')),
  unsubscribe_token TEXT NOT NULL UNIQUE,
  region TEXT NOT NULL CHECK(region IN ('us','eu')),
  confirmed INTEGER NOT NULL DEFAULT 0 CHECK(confirmed IN (0,1)),
  confirmed_at TEXT
);


-- ============================================================
-- RATE LIMIT (production: turso/sohamhamso-corpus or KV)
-- Shared API quota tracking for rate-limit gateway.
-- ============================================================

CREATE TABLE IF NOT EXISTS api_quota (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  window_start TEXT NOT NULL,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  tokens_limit INTEGER NOT NULL,
  UNIQUE (provider, window_start)
);


-- ============================================================
-- DATASET RELEASES (provenance)
-- Versioned dataset snapshots; each release gets a Zenodo DOI.
-- ============================================================

CREATE TABLE IF NOT EXISTS dataset_releases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT NOT NULL UNIQUE,  -- vYYYY.MM.DD
  zenodo_doi TEXT,
  released_at TEXT NOT NULL DEFAULT (datetime('now')),
  notes TEXT
);
