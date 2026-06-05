// biome-ignore lint/correctness/noUndeclaredDependencies: bun built-in
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSeoPreviewFromDb, buildSeoPreviewFromHtml } from '../../scripts/seo-preview';
import { __setDbForTests } from '../../src/lib/db';

const SCHEMA_PATH = resolve(__dirname, '..', '..', 'db', 'schema.sql');
const FIXTURE_ROOT = resolve(__dirname, '..', 'fixtures', 'seo');
const SITE_ORIGIN = 'https://sohamhamso.org';

let db: Database;

beforeAll(() => {
  db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));

  db.exec(`
    INSERT INTO texts (id, slug, title_sa, title_en, title_iast, tradition, school, license, description)
    VALUES (
      'siva-sutras',
      'siva-sutras',
      'शिवसूत्राणि',
      'Siva Sutras',
      'Siva-sutra',
      'trika',
      'kashmir-shaivism',
      'CC-BY-4.0',
      'Foundational aphorisms of the Trika tradition.'
    );
  `);

  db.exec(`
    INSERT INTO verses (text_id, chapter, verse_num, devanagari, iast, slp1, meter)
    VALUES ('siva-sutras', 1, 1, 'चैतन्यमात्मा ॥१॥', 'caitanyam atma', 'caitanyamAtmA', 'sutra');
  `);

  const verse = db
    .query<{ id: number }, []>(
      "SELECT id FROM verses WHERE text_id='siva-sutras' AND chapter=1 AND verse_num=1",
    )
    .get();

  db.exec(`
    INSERT INTO translations
      (verse_id, lang, translator, translation_text, license, status, ai_assisted)
    VALUES
      (${verse?.id}, 'en', 'PD', 'Consciousness is the Self.', 'PD', 'published', 0),
      (${verse?.id}, 'hi', 'AI', 'चैतन्य ही आत्मा है।', 'CC-BY-4.0', 'published', 1);
  `);

  db.exec(`
    INSERT INTO word_glosses
      (verse_id, word_idx, word_sa, lemma_sa, lemma_iast, gloss_lang, gloss_text, morph)
    VALUES
      (${verse?.id}, 0, 'चैतन्यम्', 'caitanya', 'caitanya', 'en', 'pure consciousness', 'nom. sg. n.'),
      (${verse?.id}, 0, 'चैतन्यम्', 'caitanya', 'caitanya', 'hi', 'शुद्ध चेतना', 'nom. sg. n.');
  `);

  __setDbForTests(db);
});

afterAll(() => {
  __setDbForTests(null);
  db?.close();
});

describe('buildSeoPreviewFromDb()', () => {
  it('builds a localized verse preview from the corpus DB helpers', () => {
    const preview = buildSeoPreviewFromDb({
      textSlug: 'siva-sutras',
      lang: 'hi',
      verse: '1.1',
      siteOrigin: SITE_ORIGIN,
    });

    expect(preview.kind).toBe('verse');
    expect(preview.routePath).toBe('/hi/trika/siva-sutras/1/1');
    expect(preview.canonical).toBe('https://sohamhamso.org/hi/trika/siva-sutras/1/1');
    expect(preview.description).toContain('चैतन्य ही आत्मा है');
    expect(preview.hreflang.map((entry) => entry.hrefLang)).toEqual(['en', 'hi', 'x-default']);
    expect(preview.context.translationLangUsed).toBe('hi');
  });

  it('builds a text preview without requiring a full build', () => {
    const preview = buildSeoPreviewFromDb({
      textSlug: 'siva-sutras',
      lang: 'en',
      siteOrigin: SITE_ORIGIN,
    });

    expect(preview.kind).toBe('text');
    expect(preview.routePath).toBe('/trika/siva-sutras');
    expect(preview.title).toContain('Siva Sutras');
    expect(preview.context.chapterCount).toBe(1);
    expect(preview.context.verseCount).toBe(1);
  });
});

describe('buildSeoPreviewFromHtml()', () => {
  it('extracts a build-preview summary from existing HTML', async () => {
    const preview = await buildSeoPreviewFromHtml({
      filePath: resolve(FIXTURE_ROOT, 'valid-en-verse.html'),
      distDir: FIXTURE_ROOT,
      siteOrigin: SITE_ORIGIN,
    });

    expect(preview.kind).toBe('html');
    expect(preview.title).toBe('Siva Sutras 1.1 in English | sohamhamso verse guide');
    expect(preview.canonical).toBe('https://sohamhamso.org/trika/siva-sutras/1/1');
    expect(preview.hreflang).toHaveLength(3);
  });
});
