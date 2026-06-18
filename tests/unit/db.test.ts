// biome-ignore lint/correctness/noUndeclaredDependencies: bun built-in
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
/**
 * Unit tests for `src/lib/db.ts` query helpers.
 *
 * Strategy:
 *   - Open an in-memory SQLite DB (`:memory:`) via `bun:sqlite`.
 *   - Apply the production schema from `db/schema.sql`.
 *   - Seed a tiny inline fixture (2 texts × 1 chapter × 2 verses each,
 *     plus translations, word_glosses, and one parallel).
 *   - Inject the seeded DB via `__setDbForTests` so the module-level
 *     helpers (`listTexts`, `getVerse`, …) read from it.
 *
 * Run with: `bun --bun vitest run tests/unit/db.test.ts`
 * (Vitest must be hosted by Bun so `bun:sqlite` resolves natively.)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { __setDbForTests, getVerse, listChapterVerses, listTexts } from '../../src/lib/db';

const SCHEMA_PATH = resolve(__dirname, '..', '..', 'db', 'schema.sql');

let db: Database;

beforeAll(() => {
  db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));

  // ── Seed: two texts ────────────────────────────────────────────────────
  db.exec(`
    INSERT INTO texts (id, slug, title_sa, title_en, title_iast, tradition, school, license)
    VALUES
      ('siva-sutras', 'siva-sutras', 'शिवसूत्राणि', 'Śiva Sūtras', 'Śivasūtrāṇi',
       'trika', 'kashmir-shaivism', 'CC-BY-4.0'),
      ('spanda-karikas', 'spanda-karikas', 'स्पन्दकारिका', 'Spanda Kārikās', 'Spandakārikā',
       'trika', 'kashmir-shaivism', 'CC-BY-4.0');
  `);

  // ── Seed: verses (1 chapter, 2 verses each) ────────────────────────────
  db.exec(`
    INSERT INTO verses (text_id, chapter, verse_num, devanagari, iast, slp1, meter)
    VALUES
      ('siva-sutras', 1, 1, 'चैतन्यमात्मा ॥१॥', 'caitanyam ātmā', 'caitanyamAtmA', 'sūtra'),
      ('siva-sutras', 1, 2, 'ज्ञानं बन्धः ॥२॥', 'jñānaṃ bandhaḥ', 'jYAnaM banDaH', 'sūtra'),
      ('spanda-karikas', 1, 1, 'यस्योन्मेषनिमेषाभ्याम् ।', 'yasyonmeṣanimeṣābhyām',
       'yasyonmeRanimeRAByAm', 'anuṣṭubh'),
      ('spanda-karikas', 1, 2, 'तं शक्तिचक्रविभवप्रभवम् ।', 'taṃ śakticakravibhavaprabhavam',
       'taM SaktickakravibhavaprabhavaM', 'anuṣṭubh');
  `);

  // Resolve verse_ids for the join-key tests + dependent rows.
  type IdRow = { id: number };
  const sivaV1 = db
    .query<IdRow, []>(
      "SELECT id FROM verses WHERE text_id='siva-sutras' AND chapter=1 AND verse_num=1",
    )
    .get() as IdRow;
  const sivaV2 = db
    .query<IdRow, []>(
      "SELECT id FROM verses WHERE text_id='siva-sutras' AND chapter=1 AND verse_num=2",
    )
    .get() as IdRow;
  const spandaV1 = db
    .query<IdRow, []>(
      "SELECT id FROM verses WHERE text_id='spanda-karikas' AND chapter=1 AND verse_num=1",
    )
    .get() as IdRow;

  // ── Seed: translations (mix of EN + DE, mix of ai_assisted 0/1) ────────
  db.exec(`
    INSERT INTO translations
      (verse_id, lang, translator, translation_text, license, status, ai_assisted)
    VALUES
      (${sivaV1.id}, 'en', 'PD',  'Consciousness is the Self.', 'PD', 'published', 0),
      (${sivaV1.id}, 'en', 'AI',  'The Self is pure consciousness.', 'CC-BY-4.0', 'reviewed', 1),
      (${sivaV1.id}, 'de', 'PD',  'Bewusstsein ist das Selbst.', 'PD', 'published', 0),
      (${sivaV1.id}, 'en', 'Draft', 'Should be hidden.', 'PD', 'draft', 0)
  `);

  // ── Seed: word_glosses for sivaV1 ──────────────────────────────────────
  db.exec(`
    INSERT INTO word_glosses
      (verse_id, word_idx, word_sa, lemma_sa, lemma_iast, gloss_lang, gloss_text, morph)
    VALUES
      (${sivaV1.id}, 0, 'caitanyam', 'caitanya', 'caitanya', 'en',
       'pure consciousness', 'nom. sg. n.'),
      (${sivaV1.id}, 1, 'ātmā',      'ātman',    'ātman',    'en',
       'the Self',           'nom. sg. m.')
  `);

  // ── Seed: parallel (siva 1.1 -> spanda 1.1) ────────────────────────────
  db.exec(`
    INSERT INTO parallels (source_verse_id, target_verse_id, citation_type, confidence)
    VALUES (${sivaV1.id}, ${spandaV1.id}, 'thematic', 0.85)
  `);

  // Make sure FK + join-key wiring actually landed.
  expect(sivaV1.id).toBeGreaterThan(0);
  expect(sivaV2.id).toBeGreaterThan(0);
  expect(spandaV1.id).toBeGreaterThan(0);

  // Inject so db.ts helpers query this in-memory DB.
  __setDbForTests(db);
});

afterAll(() => {
  __setDbForTests(null);
  db?.close();
});

describe('listTexts()', () => {
  it('returns one row per text with the expected shape', () => {
    const texts = listTexts();
    expect(texts).toHaveLength(2);

    const siva = texts.find((t) => t.slug === 'siva-sutras');
    expect(siva).toBeDefined();
    expect(siva).toMatchObject({
      id: 'siva-sutras',
      slug: 'siva-sutras',
      title_sa: 'शिवसूत्राणि',
      title_en: 'Śiva Sūtras',
      title_iast: 'Śivasūtrāṇi',
      tradition: 'trika',
      school: 'kashmir-shaivism',
    });
    expect(siva!.verse_count).toBe(2);

    const spanda = texts.find((t) => t.slug === 'spanda-karikas');
    expect(spanda!.verse_count).toBe(2);
  });

  it('orders results by title_en ascending', () => {
    const titles = listTexts().map((t) => t.title_en);
    expect(titles).toEqual([...titles].sort());
  });
});

describe('getVerse()', () => {
  it('returns the verse plus its translations and word_glosses', () => {
    const page = getVerse('siva-sutras', 1, 1);
    expect(page).not.toBeNull();
    expect(page!.text.slug).toBe('siva-sutras');
    expect(page!.verse).toMatchObject({
      text_id: 'siva-sutras',
      chapter: 1,
      verse_num: 1,
      devanagari: 'चैतन्यमात्मा ॥१॥',
      iast: 'caitanyam ātmā',
    });
    // Default lang='en' — drafts are EXCLUDED from public reads (Phase 2
    // A7 resolution, matching the methodology page's promise that score<7
    // stays draft and never surfaces). The fixture's draft row must not
    // appear here.
    expect(page!.translations).toHaveLength(2);
    expect(page!.translations.every((t) => t.lang === 'en')).toBe(true);
    expect(page!.translations.every((t) => t.status !== 'draft')).toBe(true);
    expect(page!.wordGlosses).toHaveLength(2);
  });

  it('returns null for a non-existent verse', () => {
    expect(getVerse('siva-sutras', 99, 99)).toBeNull();
    expect(getVerse('does-not-exist', 1, 1)).toBeNull();
  });

  it('filters translations by `lang` arg', () => {
    const en = getVerse('siva-sutras', 1, 1, 'en');
    const de = getVerse('siva-sutras', 1, 1, 'de');
    expect(en!.translations.every((t) => t.lang === 'en')).toBe(true);
    expect(de).not.toBeNull();
    expect(de!.translations).toHaveLength(1);
    expect(de!.translations[0]!.lang).toBe('de');
    expect(de!.translations[0]!.translation_text).toBe('Bewusstsein ist das Selbst.');
  });

  it('normalises SQLite ai_assisted 0/1 to a real JS boolean', () => {
    const page = getVerse('siva-sutras', 1, 1);
    expect(page!.translations).toHaveLength(2);
    for (const t of page!.translations) {
      // typeof check is the load-bearing assertion — `1 === true` is false
      // in JS, but a buggy mapper would still pass a deep-equal check.
      expect(typeof t.ai_assisted).toBe('boolean');
    }
    const ai = page!.translations.find((t) => t.translator === 'AI');
    const pd = page!.translations.find((t) => t.translator === 'PD');
    expect(ai!.ai_assisted).toBe(true);
    expect(pd!.ai_assisted).toBe(false);
  });

  it('joins parallels onto target verse summary via verse_id', () => {
    const page = getVerse('siva-sutras', 1, 1);
    expect(page!.parallels).toHaveLength(1);
    const p = page!.parallels[0]!;
    expect(p.target_text_slug).toBe('spanda-karikas');
    expect(p.target_chapter).toBe(1);
    expect(p.target_verse_num).toBe(1);
    expect(p.confidence).toBeCloseTo(0.85);
    expect(p.target_devanagari).toContain('यस्य');
  });

  it('populates prev/next within the same text', () => {
    const v1 = getVerse('siva-sutras', 1, 1);
    const v2 = getVerse('siva-sutras', 1, 2);
    expect(v1!.prev).toBeNull();
    expect(v1!.next).toEqual({ chapter: 1, verse_num: 2 });
    expect(v2!.prev).toEqual({ chapter: 1, verse_num: 1 });
    expect(v2!.next).toBeNull();
  });
});

describe('listChapterVerses()', () => {
  it('returns verses in verse_num order', () => {
    const verses = listChapterVerses('siva-sutras', 1);
    expect(verses).toHaveLength(2);
    expect(verses.map((v) => v.verse_num)).toEqual([1, 2]);
    expect(verses[0]).toMatchObject({
      chapter: 1,
      verse_num: 1,
      devanagari: 'चैतन्यमात्मा ॥१॥',
      iast: 'caitanyam ātmā',
    });
  });

  it('returns [] for a chapter with no verses', () => {
    expect(listChapterVerses('siva-sutras', 99)).toEqual([]);
  });
});
