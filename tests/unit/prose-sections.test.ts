// biome-ignore lint/correctness/noUndeclaredDependencies: bun built-in
import { Database } from 'bun:sqlite';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
/**
 * Prose sections (plan A4 data side): Zod accept/reject for the new
 * verse-level `section_type` / `prose_block_ref` fields, plus an ingest
 * round-trip of a prose fixture (persist + reconcile).
 *
 * Run with: `bun --bun vitest run tests/unit/prose-sections.test.ts`
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from '../../pipeline/ingest/ingest';
import { CorpusVerseSchema } from '../../src/lib/seo/corpus-schema';

const SCHEMA_PATH = resolve(__dirname, '..', '..', 'db', 'schema.sql');

// ---------------------------------------------------------------
// Zod — CorpusVerseSchema
// ---------------------------------------------------------------

describe('CorpusVerseSchema — section_type / prose_block_ref', () => {
  const base = { verse_num: 1, devanagari: 'अथ' };

  it('defaults section_type to verse when absent', () => {
    const parsed = CorpusVerseSchema.parse(base);
    expect(parsed.section_type).toBe('verse');
    expect(parsed.prose_block_ref).toBeUndefined();
  });

  it('accepts a prose block with a prose_block_ref', () => {
    const parsed = CorpusVerseSchema.parse({
      ...base,
      section_type: 'prose',
      prose_block_ref: 'uddyota-1.1',
    });
    expect(parsed.section_type).toBe('prose');
    expect(parsed.prose_block_ref).toBe('uddyota-1.1');
  });

  it('accepts a prose block without a prose_block_ref', () => {
    expect(CorpusVerseSchema.parse({ ...base, section_type: 'prose' }).section_type).toBe('prose');
  });

  it('rejects unknown section_type values', () => {
    expect(() => CorpusVerseSchema.parse({ ...base, section_type: 'stanza' })).toThrow();
  });

  it('rejects prose_block_ref on a verse-typed entry', () => {
    expect(() => CorpusVerseSchema.parse({ ...base, prose_block_ref: 'x' })).toThrow(
      /requires section_type: prose/,
    );
    expect(() =>
      CorpusVerseSchema.parse({ ...base, section_type: 'verse', prose_block_ref: 'x' }),
    ).toThrow(/requires section_type: prose/);
  });

  it('rejects verse_num 0 — prose blocks use numbering >= 1 (0 is reserved)', () => {
    expect(() =>
      CorpusVerseSchema.parse({ verse_num: 0, devanagari: 'अथ', section_type: 'prose' }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------
// Ingest round-trip
// ---------------------------------------------------------------

const PROSE_YAML = `
id: prose-test
slug: prose-test
title_sa: गद्यपरीक्षा
title_en: Prose Test
tradition: trika
license: PD
chapters:
  - chapter: 1
    verses:
      - verse_num: 1
        devanagari: "चैतन्यमात्मा"
        section_type: verse
      - verse_num: 2
        devanagari: "अथ व्याख्या क्रियते"
        section_type: prose
        prose_block_ref: "uddyota-1.1"
        translations:
          - lang: en
            translator: "test"
            translation_text: "Now the commentary is given."
            license: PD
            status: published
      - verse_num: 3
        devanagari: "ज्ञानं बन्धः"
`;

describe('ingest round-trip — prose fixture', () => {
  let tmp: string;
  let dbPath: string;
  let corpusDir: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sohamhamso-prose-'));
    dbPath = join(tmp, 'test.db');
    corpusDir = join(tmp, 'corpus');
    mkdirSync(corpusDir, { recursive: true });
    writeFileSync(join(corpusDir, 'prose-test.yaml'), PROSE_YAML, 'utf8');
    const db = new Database(dbPath);
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
    db.close();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function readRows(): Array<{
    verse_num: number;
    section_type: string;
    prose_block_ref: string | null;
  }> {
    const db = new Database(dbPath, { readonly: true });
    try {
      return db
        .query<{ verse_num: number; section_type: string; prose_block_ref: string | null }, []>(
          "SELECT verse_num, section_type, prose_block_ref FROM verses WHERE text_id = 'prose-test' ORDER BY verse_num",
        )
        .all();
    } finally {
      db.close();
    }
  }

  it('persists section_type and prose_block_ref (defaulting omitted entries to verse)', () => {
    const summary = run({ dbPath, corpusDir });
    expect(summary.total_verses).toBe(3);

    expect(readRows()).toEqual([
      { verse_num: 1, section_type: 'verse', prose_block_ref: null },
      { verse_num: 2, section_type: 'prose', prose_block_ref: 'uddyota-1.1' },
      { verse_num: 3, section_type: 'verse', prose_block_ref: null },
    ]);
  });

  it('reconciles the new fields on re-ingest (update + revert to default)', () => {
    run({ dbPath, corpusDir });

    // Re-point the prose block's ref, and flip verse 3 to prose.
    const mutated = PROSE_YAML.replace('uddyota-1.1', 'uddyota-1.2').replace(
      '- verse_num: 3\n        devanagari: "ज्ञानं बन्धः"',
      '- verse_num: 3\n        devanagari: "ज्ञानं बन्धः"\n        section_type: prose',
    );
    expect(mutated).toContain('uddyota-1.2');
    expect(mutated.trimEnd().endsWith('section_type: prose')).toBe(true);
    writeFileSync(join(corpusDir, 'prose-test.yaml'), mutated, 'utf8');
    run({ dbPath, corpusDir });

    expect(readRows()).toEqual([
      { verse_num: 1, section_type: 'verse', prose_block_ref: null },
      { verse_num: 2, section_type: 'prose', prose_block_ref: 'uddyota-1.2' },
      { verse_num: 3, section_type: 'prose', prose_block_ref: null },
    ]);

    // Revert: dropping the fields entirely reconciles back to the defaults.
    writeFileSync(join(corpusDir, 'prose-test.yaml'), PROSE_YAML, 'utf8');
    run({ dbPath, corpusDir });

    expect(readRows()).toEqual([
      { verse_num: 1, section_type: 'verse', prose_block_ref: null },
      { verse_num: 2, section_type: 'prose', prose_block_ref: 'uddyota-1.1' },
      { verse_num: 3, section_type: 'verse', prose_block_ref: null },
    ]);
  });

  it('rejects YAML that puts prose_block_ref on a non-prose entry', () => {
    writeFileSync(
      join(corpusDir, 'prose-test.yaml'),
      PROSE_YAML.replace('        section_type: prose\n', ''),
      'utf8',
    );
    expect(() => run({ dbPath, corpusDir })).toThrow(/requires section_type: prose/);
  });
});
