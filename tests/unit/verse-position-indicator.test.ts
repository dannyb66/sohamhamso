// biome-ignore lint/correctness/noUndeclaredDependencies: bun built-in
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
/**
 * Verse-position indicator (plan wayfinding item P4):
 *
 *   The verse-page chrome locator reads "· 5.22 / 142" — verse position
 *   plus chapter length — instead of the bare "· 5.22".
 *
 * Two layers, both load-bearing (this project's vitest config cannot
 * render `.astro` pages — see tests/unit/seo/breadcrumbs.test.ts):
 *
 *  1. DB contract: listChapters().verse_count (the denominator) is
 *     derived from the same `verses` rows that listChapterVerses() and
 *     the static routes enumerate, so "x / N" can never disagree with
 *     prev/next navigation.
 *  2. Raw-source assertions on BOTH verse pages (EN + [lang]): the
 *     listChapters import, the null-guarded chapterVerseCount lookup,
 *     the `chrome__count` span, and the mobile-truncation CSS contract
 *     (locator span never flex-shrinks; denominator is set quieter).
 *
 * Run with: `bun --bun vitest run tests/unit/verse-position-indicator.test.ts`
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { __setDbForTests, listChapterVerses, listChapters } from '../../src/lib/db';

const ROOT = resolve(__dirname, '..', '..');
const SCHEMA_PATH = resolve(ROOT, 'db', 'schema.sql');

const EN_VERSE_PAGE = resolve(ROOT, 'src/pages/[tradition]/[text]/[chapter]/[verse].astro');
const LANG_VERSE_PAGE = resolve(
  ROOT,
  'src/pages/[lang]/[tradition]/[text]/[chapter]/[verse].astro',
);

function readSource(path: string): string {
  return readFileSync(path, 'utf8');
}

// ---------------------------------------------------------------
// 1. DB contract — denominator matches the locator's domain
// ---------------------------------------------------------------

describe('listChapters verse_count (the "/ N" denominator)', () => {
  let db: Database;

  beforeAll(() => {
    db = new Database(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
    db.exec(`
      INSERT INTO texts (id, slug, title_sa, title_en, title_iast, tradition, school, license)
      VALUES ('pos-test', 'pos-test', 'परीक्षा', 'Position Test', 'parīkṣā',
              'trika', 'kashmir-shaivism', 'PD');
    `);
    // Chapter 1: three verses. Chapter 2: one verse (uneven lengths so a
    // wrong GROUP BY / wrong-chapter lookup cannot pass by coincidence).
    db.exec(`
      INSERT INTO verses (text_id, chapter, verse_num, devanagari)
      VALUES
        ('pos-test', 1, 1, 'प्रथमः'),
        ('pos-test', 1, 2, 'द्वितीयः'),
        ('pos-test', 1, 3, 'तृतीयः'),
        ('pos-test', 2, 1, 'चतुर्थः');
    `);
    __setDbForTests(db);
  });

  afterAll(() => {
    __setDbForTests(null);
    db.close();
  });

  it('counts verses per chapter (3 and 1)', () => {
    const chapters = listChapters('pos-test');
    expect(chapters.map((c) => ({ chapter: c.chapter, verse_count: c.verse_count }))).toEqual([
      { chapter: 1, verse_count: 3 },
      { chapter: 2, verse_count: 1 },
    ]);
  });

  it('denominator equals the number of locator positions in each chapter', () => {
    for (const c of listChapters('pos-test')) {
      const verses = listChapterVerses('pos-test', c.chapter);
      expect(c.verse_count).toBe(verses.length);
      // The chrome shows "{verse_num} / {verse_count}" — the last verse's
      // numerator must equal the denominator for sequential numbering.
      expect(verses[verses.length - 1]?.verse_num).toBe(c.verse_count);
    }
  });

  it('returns no row for an unknown chapter (page null-guard arm)', () => {
    const found = listChapters('pos-test').find((c) => c.chapter === 99);
    expect(found).toBeUndefined();
  });
});

// ---------------------------------------------------------------
// 2. Source wiring — both verse pages render "x.y / N" in the chrome
// ---------------------------------------------------------------

describe.each([
  ['EN verse page', EN_VERSE_PAGE],
  ['[lang] verse page', LANG_VERSE_PAGE],
])('%s — chrome position indicator', (_label, pagePath) => {
  const src = readSource(pagePath);

  it('imports listChapters from lib/db', () => {
    expect(src).toMatch(/import\s*\{[^}]*\blistChapters\b[^}]*\}\s*from\s*'[./]+lib\/db'/);
  });

  it('derives chapterVerseCount from listChapters for the current chapter', () => {
    expect(src).toMatch(
      /const chapterVerseCount =\s*\n?\s*listChapters\(textRow\.slug\)\.find\(\(c\) => c\.chapter === chapterNum\)\?\.verse_count \?\? null/,
    );
  });

  it('renders the null-guarded "/ N" span inside the chrome locator', () => {
    expect(src).toContain(
      '<span class="chrome__verse">· {chapterNum}.{verseNum}{chapterVerseCount ? <span class="chrome__count"> / {chapterVerseCount}</span> : null}</span>',
    );
  });

  it('keeps the locator un-shrinkable on tight mobile chrome (CSS contract)', () => {
    // .chrome__verse must declare flex-shrink: 0 so the title ellipsizes
    // before the "5.22 / 142" locator loses characters.
    expect(src).toMatch(/\.chrome__verse\s*\{[^}]*flex-shrink:\s*0;[^}]*\}/);
    // The title span carries the ellipsis now that the row is a flexbox.
    expect(src).toMatch(/\.chrome__text\s*\{[^}]*text-overflow:\s*ellipsis;[^}]*\}/);
  });

  it('sets the denominator typographically quieter than the locator', () => {
    expect(src).toMatch(
      /\.chrome__count\s*\{[^}]*font-size:\s*var\(--text-xs\);[^}]*color:\s*var\(--color-ink-muted\);[^}]*\}/,
    );
  });
});
