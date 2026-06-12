// biome-ignore lint/correctness/noUndeclaredDependencies: bun built-in
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
/**
 * Unit tests for `listTexts()` index semantics (src/lib/db.ts):
 *   - commentary rows (non-null parent_text_id) are excluded
 *   - ordering is tradition-grouped (trika → shakta → everything else),
 *     alphabetical by title_en within a group
 *   - `author` and `license` are surfaced for the /texts table columns
 *
 * Same strategy as db.test.ts: in-memory SQLite + production schema,
 * injected via `__setDbForTests`.
 *
 * Run with: `bun --bun vitest run tests/unit/list-texts.test.ts`
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { __setDbForTests, listTexts } from '../../src/lib/db';

const SCHEMA_PATH = resolve(__dirname, '..', '..', 'db', 'schema.sql');

let db: Database;

beforeAll(() => {
  db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));

  // Deliberately inserted out of display order: shakta + an unknown
  // tradition before trika, and trika titles reverse-alphabetical.
  db.exec(`
    INSERT INTO texts (id, slug, title_sa, title_en, tradition, school, author, license, parent_text_id)
    VALUES
      ('karpuradi-stotra', 'karpuradi-stotra', 'कर्पूरादिस्तोत्रम्', 'Karpūrādi Stotra',
       'shakta', 'kaula', NULL, 'CC-BY-SA', NULL),
      ('mystery-text', 'mystery-text', 'अज्ञातग्रन्थः', 'Mystery Text',
       'kaula', NULL, NULL, 'PD', NULL),
      ('spanda-karikas', 'spanda-karikas', 'स्पन्दकारिकाः', 'Spanda Kārikās',
       'trika', 'kashmir-shaivism', 'Vasugupta', 'PD', NULL),
      ('siva-sutras', 'siva-sutras', 'शिवसूत्राणि', 'Śiva Sūtras',
       'trika', 'kashmir-shaivism', 'Vasugupta', 'CC-BY 4.0', NULL),
      ('spanda-nirnaya', 'spanda-nirnaya', 'स्पन्दनिर्णयः', 'Spanda Nirṇaya',
       'trika', 'kashmir-shaivism', 'Kṣemarāja', 'PD', 'spanda-karikas');
  `);

  db.exec(`
    INSERT INTO verses (text_id, chapter, verse_num, devanagari)
    VALUES
      ('siva-sutras', 1, 1, 'चैतन्यमात्मा ॥१॥'),
      ('siva-sutras', 1, 2, 'ज्ञानं बन्धः ॥२॥'),
      ('karpuradi-stotra', 1, 1, 'खर्वं स्थूलतनुम् ।')
  `);

  __setDbForTests(db);
});

afterAll(() => {
  __setDbForTests(null);
  db?.close();
});

describe('listTexts() index semantics', () => {
  it('excludes commentary rows with a non-null parent_text_id', () => {
    const texts = listTexts();
    expect(texts).toHaveLength(4);
    expect(texts.some((t) => t.slug === 'spanda-nirnaya')).toBe(false);
  });

  it('orders tradition-grouped (trika → shakta → other), alpha by title_en within group', () => {
    const slugs = listTexts().map((t) => t.slug);
    expect(slugs).toEqual([
      'spanda-karikas', // trika: "Spanda…" < "Śiva…" in SQLite binary collation
      'siva-sutras',
      'karpuradi-stotra', // shakta
      'mystery-text', // unknown tradition sorts last
    ]);
  });

  it('surfaces author + license for the /texts table columns', () => {
    const siva = listTexts().find((t) => t.slug === 'siva-sutras');
    expect(siva).toMatchObject({ author: 'Vasugupta', license: 'CC-BY 4.0' });
    const karp = listTexts().find((t) => t.slug === 'karpuradi-stotra');
    expect(karp).toMatchObject({ author: null, license: 'CC-BY-SA' });
  });

  it('keeps verse_count accurate alongside the new columns', () => {
    const bySlug = new Map(listTexts().map((t) => [t.slug, t.verse_count]));
    expect(bySlug.get('siva-sutras')).toBe(2);
    expect(bySlug.get('karpuradi-stotra')).toBe(1);
    expect(bySlug.get('spanda-karikas')).toBe(0);
  });
});
