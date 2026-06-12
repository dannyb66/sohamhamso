-- ============================================================
-- Migration 002 — chapter titles (plan wayfinding item)
--
-- Adds:
--   chapters  per-(text_id, chapter) editorial titles
--
-- Chapters themselves stay derived from `verses` (listChapters
-- GROUP BY); this table only carries optional wayfinding titles
-- (title_sa / title_iast / title_en) from the corpus YAML. Rows are
-- content-conditional: ingest only writes a row when the YAML chapter
-- declares at least one title, and reconciles rows away when the
-- titles (or the chapter) disappear from the YAML.
--
-- db/schema.sql remains the canonical fresh-create and already
-- contains this table; the guard below lets the runner stamp this
-- migration as applied on schema.sql-fresh DBs without re-running it.
-- guard: SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'chapters'
-- ============================================================

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
