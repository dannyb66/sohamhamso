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
-- MIGRATION LEDGER (all DBs)
-- Tracked by pipeline/ingest/migrations.ts. schema.sql stays the
-- canonical fresh-create; on a fresh DB the runner guard-stamps
-- migrations whose changes are already present here.
-- ============================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);


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
  -- Prose sections (migration 001): prose blocks reuse this table with
  -- section_type='prose' and the same verse numbering (verse_num >= 1;
  -- verse_num=0 stays reserved for chapter-format video rows in `videos`).
  section_type TEXT NOT NULL DEFAULT 'verse' CHECK (section_type IN ('verse','prose')),
  prose_block_ref TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (text_id, chapter, verse_num)
);
CREATE INDEX IF NOT EXISTS idx_verses_text ON verses(text_id);
CREATE INDEX IF NOT EXISTS idx_verses_chapter ON verses(text_id, chapter);

-- Chapter titles (migration 002): chapters stay derived from `verses`
-- (listChapters GROUP BY) — this table only carries optional wayfinding
-- titles from the corpus YAML. Content-conditional: ingest writes a row
-- only when the YAML chapter declares at least one title, and reconciles
-- rows away when the titles (or the chapter) disappear.
CREATE TABLE IF NOT EXISTS chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text_id TEXT NOT NULL REFERENCES texts(id),
  chapter INTEGER NOT NULL,
  title_sa TEXT,
  title_iast TEXT,
  title_en TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE (text_id, chapter)
);

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

-- Materialized corpus-wide lemma index. Derived from word_glosses at build
-- time (pipeline/ingest/lemma-index.ts:buildLemmaIndex), seeded to Turso.
-- WHY: the SSR verse route needs each verse's lemma → {slug, occurrence
-- count}. Deriving that by scanning word_glosses per request cost ~180k
-- Turso row-reads on every cold worker isolate (read-quota exhaustion).
-- This table lets the edge read just the verse's handful of lemmas by PK.
-- `slug` MUST equal seo/slug.ts:assignLemmaSlug applied in MIN(verse_id),
-- lemma_iast order so it matches the static /lemma/ pages. occurrence_count
-- = COUNT(DISTINCT verse_id) corpus-wide for the lemma.
CREATE TABLE IF NOT EXISTS lemma_index (
  lemma_iast TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  occurrence_count INTEGER NOT NULL
);

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
  email_hash TEXT NOT NULL,  -- HMAC-SHA256(email, SUBSCRIBER_HASH_PEPPER env)
  language TEXT NOT NULL DEFAULT 'en',
  subscribed_at TEXT NOT NULL DEFAULT (datetime('now')),
  unsubscribe_token TEXT NOT NULL UNIQUE,
  region TEXT NOT NULL CHECK(region IN ('us','eu')),
  confirmed INTEGER NOT NULL DEFAULT 0 CHECK(confirmed IN (0,1)),
  confirmed_at TEXT,
  -- A given email may subscribe to multiple languages (one row per
  -- (email_hash, language) pair). Idempotent re-subscribes hit this
  -- unique key and are absorbed at the API layer.
  UNIQUE (email_hash, language)
);
CREATE INDEX IF NOT EXISTS idx_subscribers_email_hash ON subscribers(email_hash);


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


-- ============================================================
-- YOUTUBE SHORTS PIPELINE (Phase 1)
-- Lifecycle + analytics + run-log + quota + events.
-- Additive, idempotent. Applied via scripts/turso-apply-schema.sh.
-- Determinism contract: translation_md5 + template_version
-- (no input_hash — superseded per Eng review E1).
-- ============================================================

CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Identity
  text_id TEXT NOT NULL REFERENCES texts(id),
  chapter INTEGER NOT NULL,
  verse_num INTEGER NOT NULL,
  lang TEXT NOT NULL,
  short_index INTEGER NOT NULL DEFAULT 0,
  -- Distribution format: 'short' (9:16 one-verse) | 'chapter' (16:9 full
  -- chapter; chapter rows use verse_num=0 — corpus verses start at 1, so the
  -- UNIQUE determinism key below needs no change).
  format TEXT NOT NULL DEFAULT 'short' CHECK(format IN ('short','chapter')),
  channel_handle TEXT NOT NULL DEFAULT '@sohamhamso',
  kula TEXT NOT NULL,
  style_preset TEXT NOT NULL,
  -- Determinism (simplified per E1 — no input_hash)
  translation_md5 TEXT NOT NULL,
  template_version TEXT NOT NULL,
  output_file_sha256 TEXT,
  output_bytes INTEGER,
  -- Pinned provenance (for replay 6mo later)
  tts_voice_id TEXT NOT NULL,
  translation_row_id INTEGER NOT NULL REFERENCES translations(id),
  remotion_version TEXT NOT NULL,
  ffmpeg_version TEXT NOT NULL,
  -- Lifecycle
  status TEXT NOT NULL CHECK(status IN (
    'pending','rendering','rendered','approved','rejected',
    'uploading','uploaded','failed','superseded'
  )),
  -- Lease/TTL for crash recovery (E4)
  rendering_lease_at TEXT,
  uploading_lease_at TEXT,
  -- Storage refs
  r2_key TEXT,
  duration_s REAL,
  youtube_video_id TEXT,
  youtube_url TEXT,
  visibility TEXT DEFAULT 'unlisted' CHECK(visibility IN ('unlisted','public','private')),
  -- Lifecycle audit
  retry_count INTEGER DEFAULT 0,
  upload_retry_count INTEGER DEFAULT 0,
  last_error TEXT,                     -- redacted at write-time per E6 (scrubError)
  last_error_phase TEXT,
  approved_at TEXT,
  approved_by TEXT,
  rendered_at TEXT,
  uploaded_at TEXT,
  priority INTEGER DEFAULT 0,
  -- Supersede policy (E2)
  supersedes_video_id INTEGER REFERENCES videos(id),
  superseded_at TEXT,
  superseded_action TEXT CHECK(superseded_action IN ('auto-private','replace-asset','manual',NULL)),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE (text_id, chapter, verse_num, lang, short_index, translation_md5, template_version)
);

-- Per E3: analytics is its own table. Queryable separately from lifecycle state.
CREATE TABLE IF NOT EXISTS video_analytics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL REFERENCES videos(id),
  synced_at TEXT NOT NULL,
  view_count INTEGER DEFAULT 0,
  watch_time_s INTEGER DEFAULT 0,
  ctr REAL,
  retention_3s REAL,
  retention_50 REAL,
  completion_rate REAL,
  link_clicks_utm INTEGER DEFAULT 0,
  subscribers_gained INTEGER DEFAULT 0,
  -- Audio-track language dimension for the multi-language-audio test
  -- (NULL = the video's default track).
  audio_lang TEXT,
  UNIQUE (video_id, synced_at)
);

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  video_id INTEGER REFERENCES videos(id),
  phase TEXT NOT NULL CHECK(phase IN ('plan','render','probe','upload','status','rotation')),
  status TEXT NOT NULL CHECK(status IN ('ok','err','skip','dryrun')),
  duration_ms INTEGER,
  tts_bytes_synthesized INTEGER DEFAULT 0,
  r2_bytes_written INTEGER DEFAULT 0,
  youtube_api_units INTEGER DEFAULT 0,
  error_code TEXT,
  error_msg TEXT,
  started_at TEXT DEFAULT (datetime('now')),
  finished_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS youtube_quota (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_handle TEXT NOT NULL,
  utc_date TEXT NOT NULL,
  units_spent INTEGER NOT NULL DEFAULT 0,
  uploads_count INTEGER NOT NULL DEFAULT 0,
  exhausted INTEGER NOT NULL DEFAULT 0,
  UNIQUE (channel_handle, utc_date)
);

CREATE TABLE IF NOT EXISTS video_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL REFERENCES videos(id),
  event TEXT NOT NULL,
  meta TEXT,
  occurred_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
CREATE INDEX IF NOT EXISTS idx_videos_format_status ON videos(format, status);
CREATE INDEX IF NOT EXISTS idx_videos_verse_lookup ON videos(text_id, chapter, verse_num, lang);
CREATE INDEX IF NOT EXISTS idx_video_analytics_video ON video_analytics(video_id, synced_at DESC);
