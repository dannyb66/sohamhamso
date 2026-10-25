-- ============================================================
-- Migration 003 — materialized lemma_index (build-time summaries)
--
-- Adds:
--   lemma_index  corpus-wide lemma → {slug, occurrence_count}
--
-- Materialized at ingestion time by pipeline/ingest/lemma-index.ts.
-- Static exports and local tools reuse the derived rows. The migration
-- creates the table; ingestion rebuilds its contents from word_glosses.
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
