-- ============================================================
-- Migration 001 — prose sections on verses (plan A4 data side)
--
-- Adds:
--   verses.section_type     'verse' (default) | 'prose'
--   verses.prose_block_ref  free-form editorial ref for prose blocks
--
-- Prose blocks reuse the verses table and its numbering: verse_num
-- starts at 1 (verse_num=0 stays reserved for chapter-format video
-- rows, which live in `videos`, never in `verses`).
--
-- db/schema.sql remains the canonical fresh-create and already
-- contains these columns; the guard below lets the runner stamp this
-- migration as applied on schema.sql-fresh DBs without re-running it.
-- guard: SELECT count(*) FROM pragma_table_info('verses') WHERE name = 'section_type'
-- ============================================================

ALTER TABLE verses ADD COLUMN section_type TEXT NOT NULL DEFAULT 'verse' CHECK (section_type IN ('verse','prose'));

ALTER TABLE verses ADD COLUMN prose_block_ref TEXT;
