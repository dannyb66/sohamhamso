-- ============================================================
-- Migration 003 — materialized lemma_index (Turso read-quota fix)
--
-- Adds:
--   lemma_index  corpus-wide lemma → {slug, occurrence_count}
--
-- The SSR verse route used to derive this map by full-scanning
-- word_glosses once per worker isolate; against Turso (billed per row
-- read) that burned ~180k rows on every cold isolate and exhausted the
-- read quota. This table is materialized at build time
-- (pipeline/ingest/lemma-index.ts) and seeded to Turso
-- (scripts/turso-seed-lemma-index.ts) so the edge reads only the handful
-- of lemmas a verse uses, by primary key.
--
-- The table is DERIVED (not authored): the migration only creates the
-- empty table; rows are (re)built from word_glosses each deploy. Run this
-- with --turso BEFORE seeding lemma_index.
--
-- db/schema.sql remains the canonical fresh-create and already contains
-- this table; the guard stamps this migration as applied on
-- schema.sql-fresh DBs without re-running it.
-- guard: SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'lemma_index'
-- ============================================================

CREATE TABLE IF NOT EXISTS lemma_index (
  lemma_iast TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  occurrence_count INTEGER NOT NULL
);
