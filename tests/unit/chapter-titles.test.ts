// biome-ignore lint/correctness/noUndeclaredDependencies: bun built-in
import { Database } from 'bun:sqlite';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
/**
 * Chapter titles end-to-end (plan wayfinding item):
 *
 *   - ingest round-trip: YAML chapter title_sa/title_iast/title_en persist
 *     into the `chapters` table (migration 002), content-conditionally —
 *     untitled chapters get no row
 *   - reconciliation: dropping the titles (or the whole chapter) from the
 *     YAML deletes the row; unchanged re-ingest is a true no-op
 *   - listChapters(): exposes title_sa/title_iast/title_en (NULL when
 *     untitled) without disturbing chapter/verse_count for existing callers
 *   - render check: both text-overview pages (EN + [lang]) show the
 *     "5 — Creation of the world" title cell. Astro's
 *     `experimental_AstroContainer` cannot render `.astro` pages in this
 *     setup (see tests/unit/seo/breadcrumbs.test.ts), so this is a
 *     source-level fixture check on the chapter-row markup.
 *
 * Run with: `bun --bun vitest run tests/unit/chapter-titles.test.ts`
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from '../../pipeline/ingest/ingest';
import { __setDbForTests, listChapters } from '../../src/lib/db';

const ROOT = resolve(__dirname, '..', '..');
const SCHEMA_PATH = join(ROOT, 'db', 'schema.sql');

const TITLED_YAML = `
id: chapter-title-test
slug: chapter-title-test
title_sa: अध्यायपरीक्षा
title_en: Chapter Title Test
tradition: trika
license: PD
chapters:
  - chapter: 1
    title_sa: सृष्टिप्रकरणम्
    title_iast: sṛṣṭi-prakaraṇam
    title_en: Creation of the world
    verses:
      - verse_num: 1
        devanagari: "प्रथमः"
      - verse_num: 2
        devanagari: "द्वितीयः"
  - chapter: 2
    verses:
      - verse_num: 1
        devanagari: "तृतीयः"
`;

// Same text with chapter 1's titles removed and chapter 2 unchanged.
const UNTITLED_YAML = TITLED_YAML.replace(
  /\n {4}title_sa: सृष्टिप्रकरणम्\n {4}title_iast: sṛṣṭi-prakaraṇam\n {4}title_en: Creation of the world/,
  '',
);

let tmp: string;
let dbPath: string;
let corpusDir: string;

function initSchema(path: string): void {
  const db = new Database(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  db.close();
}

type ChapterRow = {
  chapter: number;
  title_sa: string | null;
  title_iast: string | null;
  title_en: string | null;
  updated_at: string;
};

function chapterRows(db: Database): ChapterRow[] {
  return db
    .query<ChapterRow, []>(
      `SELECT chapter, title_sa, title_iast, title_en, updated_at
       FROM chapters WHERE text_id = 'chapter-title-test' ORDER BY chapter`,
    )
    .all();
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'sohamhamso-chapter-titles-'));
  dbPath = join(tmp, 'test.db');
  corpusDir = join(tmp, 'corpus');
  mkdirSync(corpusDir, { recursive: true });
  initSchema(dbPath);
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('ingest round-trip — chapter titles persist into `chapters`', () => {
  it('persists titles content-conditionally (untitled chapters get no row)', () => {
    writeFileSync(join(corpusDir, 'chapter-title-test.yaml'), TITLED_YAML, 'utf8');
    run({ dbPath, corpusDir });

    const db = new Database(dbPath, { readonly: true });
    try {
      const rows = chapterRows(db);
      expect(rows).toHaveLength(1); // chapter 2 declares no titles -> no row
      expect(rows[0].chapter).toBe(1);
      expect(rows[0].title_sa).toBe('सृष्टिप्रकरणम्');
      expect(rows[0].title_iast).toBe('sṛṣṭi-prakaraṇam');
      expect(rows[0].title_en).toBe('Creation of the world');
    } finally {
      db.close();
    }
  });

  it('re-ingesting unchanged titles is a no-op (updated_at untouched)', () => {
    writeFileSync(join(corpusDir, 'chapter-title-test.yaml'), TITLED_YAML, 'utf8');
    run({ dbPath, corpusDir });

    const SENTINEL = '2000-01-01 00:00:00';
    let db = new Database(dbPath);
    db.exec(`UPDATE chapters SET updated_at = '${SENTINEL}'`);
    db.close();

    run({ dbPath, corpusDir });

    db = new Database(dbPath, { readonly: true });
    try {
      expect(chapterRows(db)[0].updated_at).toBe(SENTINEL);
    } finally {
      db.close();
    }
  });

  it('updates the row (and updated_at) when a title actually changes', () => {
    writeFileSync(join(corpusDir, 'chapter-title-test.yaml'), TITLED_YAML, 'utf8');
    run({ dbPath, corpusDir });

    const SENTINEL = '2000-01-01 00:00:00';
    let db = new Database(dbPath);
    db.exec(`UPDATE chapters SET updated_at = '${SENTINEL}'`);
    db.close();

    writeFileSync(
      join(corpusDir, 'chapter-title-test.yaml'),
      TITLED_YAML.replace('Creation of the world', 'Creation, revised'),
      'utf8',
    );
    run({ dbPath, corpusDir });

    db = new Database(dbPath, { readonly: true });
    try {
      const [row] = chapterRows(db);
      expect(row.title_en).toBe('Creation, revised');
      expect(row.updated_at).not.toBe(SENTINEL);
    } finally {
      db.close();
    }
  });

  it('reconciles the row away when the YAML drops the titles', () => {
    writeFileSync(join(corpusDir, 'chapter-title-test.yaml'), TITLED_YAML, 'utf8');
    run({ dbPath, corpusDir });

    writeFileSync(join(corpusDir, 'chapter-title-test.yaml'), UNTITLED_YAML, 'utf8');
    run({ dbPath, corpusDir });

    const db = new Database(dbPath, { readonly: true });
    try {
      expect(chapterRows(db)).toHaveLength(0);
      // The verses themselves are untouched by the title reconciliation.
      const verses = db
        .query<{ n: number }, []>(
          "SELECT COUNT(*) AS n FROM verses WHERE text_id = 'chapter-title-test'",
        )
        .get();
      expect(verses?.n).toBe(3);
    } finally {
      db.close();
    }
  });

  it('reconciles the row away when the whole chapter disappears', () => {
    writeFileSync(join(corpusDir, 'chapter-title-test.yaml'), TITLED_YAML, 'utf8');
    run({ dbPath, corpusDir });

    // Keep only (renumbered) chapter 2 — chapter 1 and its titles are gone.
    const CHAPTER_GONE = `
id: chapter-title-test
slug: chapter-title-test
title_sa: अध्यायपरीक्षा
title_en: Chapter Title Test
tradition: trika
license: PD
chapters:
  - chapter: 2
    verses:
      - verse_num: 1
        devanagari: "तृतीयः"
`;
    writeFileSync(join(corpusDir, 'chapter-title-test.yaml'), CHAPTER_GONE, 'utf8');
    run({ dbPath, corpusDir });

    const db = new Database(dbPath, { readonly: true });
    try {
      expect(chapterRows(db)).toHaveLength(0);
    } finally {
      db.close();
    }
  });
});

describe('listChapters() — optional titles exposure', () => {
  let memDb: Database;

  beforeEach(() => {
    memDb = new Database(':memory:');
    memDb.exec('PRAGMA foreign_keys = ON;');
    memDb.exec(readFileSync(SCHEMA_PATH, 'utf8'));
    memDb.exec(`
      INSERT INTO texts (id, slug, title_sa, title_en, tradition, license)
      VALUES ('chapter-title-test', 'chapter-title-test', 'अध्यायपरीक्षा',
              'Chapter Title Test', 'trika', 'PD');
      INSERT INTO verses (text_id, chapter, verse_num, devanagari)
      VALUES
        ('chapter-title-test', 1, 1, 'प्रथमः'),
        ('chapter-title-test', 1, 2, 'द्वितीयः'),
        ('chapter-title-test', 2, 1, 'तृतीयः');
      INSERT INTO chapters (text_id, chapter, title_sa, title_iast, title_en)
      VALUES ('chapter-title-test', 1, 'सृष्टिप्रकरणम्', 'sṛṣṭi-prakaraṇam',
              'Creation of the world');
    `);
    __setDbForTests(memDb);
  });

  afterEach(() => {
    __setDbForTests(null);
    memDb.close();
  });

  it('returns titles for titled chapters and NULLs for untitled ones', () => {
    const chapters = listChapters('chapter-title-test');
    expect(chapters).toEqual([
      {
        chapter: 1,
        verse_count: 2,
        title_sa: 'सृष्टिप्रकरणम्',
        title_iast: 'sṛṣṭi-prakaraṇam',
        title_en: 'Creation of the world',
      },
      { chapter: 2, verse_count: 1, title_sa: null, title_iast: null, title_en: null },
    ]);
  });

  it('keeps existing callers working — chapter/verse_count shape and order intact', () => {
    const chapters = listChapters('chapter-title-test');
    expect(chapters.map((c) => c.chapter)).toEqual([1, 2]);
    expect(chapters.map((c) => c.verse_count)).toEqual([2, 1]);
  });
});

describe('text-overview pages — chapter-row title cell (source render check)', () => {
  const PAGES = [
    join(ROOT, 'src', 'pages', '[tradition]', '[text]', 'index.astro'),
    join(ROOT, 'src', 'pages', '[lang]', '[tradition]', '[text]', 'index.astro'),
  ];

  for (const page of PAGES) {
    const label = page.includes('[lang]') ? '[lang] twin' : 'EN page';

    it(`${label} renders the title inside the chapter-number cell when present`, () => {
      const src = readFileSync(page, 'utf8');
      // Title comes from listChapters' title_en, IAST fallback.
      expect(src).toMatch(/title_en \?\? \w+\.title_iast/);
      // "5 — Creation of the world" pattern: an em-dash-joined title span
      // inside the chapter-number cell, rendered only when a title exists.
      expect(src).toContain('<span class="chapter-row__title"> — {chapterTitle}</span>');
      const numCell = src.indexOf('class="chapter-row__col-num">\n');
      const titleSpan = src.indexOf('chapter-row__title');
      expect(numCell).toBeGreaterThan(-1);
      expect(titleSpan).toBeGreaterThan(numCell);
      // Quiet styling exists for the title span.
      expect(src).toContain('.chapter-row__title {');
    });
  }
});
