/**
 * Unit tests for `pipeline/ingest/lemma-index.ts` — the build-time
 * materialization of the corpus-wide lemma index into the `lemma_index`
 * table.
 *
 * WHY THIS EXISTS: the SSR verse route used to derive lemma → {slug,
 * occurrenceCount} by FULL-SCANNING `word_glosses` once per worker isolate
 * (see src/lib/verse-read.ts). Against Turso (billed per row read) that
 * burned ~180k rows on every cold isolate and exhausted the read quota.
 * The fix materializes the index at build time so the edge can read just
 * the handful of lemmas a verse actually uses.
 *
 * The materialized slugs MUST match `src/lib/seo/slug.ts:assignLemmaSlug`
 * applied in the SAME order the static `/lemma/` pages use
 * (corpus-bundle.ts:ensureLemmaIndex): GROUP BY lemma_iast, ORDER BY
 * MIN(verse_id) ASC, lemma_iast ASC. These specs pin that contract.
 *
 * Run with: `bun --bun vitest run tests/unit/lemma-index.test.ts`
 */

import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildLemmaIndex } from '../../pipeline/ingest/lemma-index';

const SCHEMA_PATH = resolve(__dirname, '..', '..', 'db', 'schema.sql');

interface LemmaRow {
  lemma_iast: string;
  slug: string;
  occurrence_count: number;
}

let db: Database;

function seedGloss(verseId: number, wordIdx: number, lemmaIast: string | null): void {
  db.query(
    `INSERT INTO word_glosses (verse_id, word_idx, word_sa, lemma_iast, gloss_lang, gloss_text)
     VALUES (?, ?, ?, ?, 'en', 'g')`,
  ).run(verseId, wordIdx, lemmaIast ?? 'x', lemmaIast);
}

function rows(): LemmaRow[] {
  return db
    .query<LemmaRow, []>('SELECT lemma_iast, slug, occurrence_count FROM lemma_index ORDER BY slug')
    .all();
}

beforeEach(() => {
  db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  db.exec(`
    INSERT INTO texts (id, slug, title_sa, title_en, tradition, license)
    VALUES ('t', 't', 'T', 'T', 'trika', 'CC-BY-4.0');
  `);
  // Verses 1..4 of text 't'.
  db.exec(`
    INSERT INTO verses (id, text_id, chapter, verse_num, devanagari, iast)
    VALUES
      (1, 't', 1, 1, 'd', 'i'),
      (2, 't', 1, 2, 'd', 'i'),
      (3, 't', 1, 3, 'd', 'i'),
      (4, 't', 1, 4, 'd', 'i');
  `);
});

describe('buildLemmaIndex', () => {
  it('counts DISTINCT verses per lemma (not gloss occurrences)', () => {
    // "ātman" appears in verses 1, 1 (twice — same verse), and 3 → 2 verses.
    seedGloss(1, 0, 'ātman');
    seedGloss(1, 1, 'ātman');
    seedGloss(3, 0, 'ātman');
    buildLemmaIndex(db);
    const atman = rows().find((r) => r.lemma_iast === 'ātman');
    expect(atman?.occurrence_count).toBe(2);
  });

  it('assigns collision-suffixed slugs in MIN(verse_id) order', () => {
    // "śiva" (first seen verse 1) and "śivā" (first seen verse 2) both
    // slugify to base "siva". Lower MIN(verse_id) keeps the bare base.
    seedGloss(2, 0, 'śivā');
    seedGloss(1, 0, 'śiva');
    buildLemmaIndex(db);
    const slugOf = (lemma: string) => rows().find((r) => r.lemma_iast === lemma)?.slug;
    expect(slugOf('śiva')).toBe('siva');
    expect(slugOf('śivā')).toBe('siva-2');
  });

  it('excludes NULL and blank lemma_iast', () => {
    seedGloss(1, 0, null);
    seedGloss(1, 1, '   ');
    seedGloss(1, 2, 'jñāna');
    buildLemmaIndex(db);
    expect(rows()).toHaveLength(1);
    expect(rows()[0].lemma_iast).toBe('jñāna');
  });

  it('is idempotent — re-running replaces, never duplicates', () => {
    seedGloss(1, 0, 'mantra');
    seedGloss(2, 0, 'mantra');
    buildLemmaIndex(db);
    const first = rows();
    buildLemmaIndex(db);
    expect(rows()).toEqual(first);
  });

  it('returns the number of indexed lemmas', () => {
    seedGloss(1, 0, 'a');
    seedGloss(2, 0, 'b');
    expect(buildLemmaIndex(db)).toBe(2);
  });
});
