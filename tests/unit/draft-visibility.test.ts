// biome-ignore lint/correctness/noUndeclaredDependencies: bun built-in
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
/**
 * Draft-visibility resolution tests (Task A7).
 *
 * The methodology page promises that translations scoring <7 stay
 * status='draft' and are EXCLUDED from public display. These tests pin
 * that contract across every public read path in `src/lib/db.ts` and the
 * search joins in `src/lib/search.ts`:
 *
 *   - a draft-only verse renders with NO translations (Devanagari+IAST
 *     still present; VerseAnatomy tolerates primaryTranslation=null)
 *   - drafts never leak into search hits or translation excerpts
 *   - explicit status priority: reviewed (human-verified) ranks above
 *     published — replacing the old alphabetical `ORDER BY status` quirk
 *     (draft < published < reviewed)
 *
 * Strategy mirrors tests/unit/db.test.ts: in-memory `bun:sqlite` DB,
 * production schema from db/schema.sql, inline seed, injected via
 * `__setDbForTests`. search.ts is exercised on its LIKE fallback (no
 * `verses_fts` table is seeded, so `_ftsAvailable` locks to false).
 *
 * Run with: `bun --bun vitest run tests/unit/draft-visibility.test.ts`
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  __setDbForTests,
  getAvailableLanguages,
  getVerse,
  getVerseAllLanguages,
  getVerseTranslations,
  listChapterSummary,
} from '../../src/lib/db';
import { lexicalSearch } from '../../src/lib/search';

const SCHEMA_PATH = resolve(__dirname, '..', '..', 'db', 'schema.sql');

let db: Database;
let v1Id: number; // 1.1 — reviewed + published EN rows (ordering test)
let v2Id: number; // 1.2 — draft-only EN row (invisibility test)

beforeAll(() => {
  // No key → semantic paths short-circuit; only lexicalSearch is exercised.
  process.env.OPENAI_API_KEY = undefined;

  db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));

  db.exec(`
    INSERT INTO texts (id, slug, title_sa, title_en, title_iast, tradition, license)
    VALUES
      ('siva-sutras', 'siva-sutras', 'शिवसूत्राणि', 'Śiva Sūtras', 'Śivasūtrāṇi',
       'trika', 'CC-BY-4.0');
  `);

  db.exec(`
    INSERT INTO verses (text_id, chapter, verse_num, devanagari, iast)
    VALUES
      ('siva-sutras', 1, 1, 'चैतन्यमात्मा ॥१॥', 'caitanyam ātmā'),
      ('siva-sutras', 1, 2, 'ज्ञानं बन्धः ॥२॥', 'jñānaṃ bandhaḥ');
  `);

  type IdRow = { id: number };
  v1Id = (
    db
      .query<IdRow, []>(
        "SELECT id FROM verses WHERE text_id='siva-sutras' AND chapter=1 AND verse_num=1",
      )
      .get() as IdRow
  ).id;
  v2Id = (
    db
      .query<IdRow, []>(
        "SELECT id FROM verses WHERE text_id='siva-sutras' AND chapter=1 AND verse_num=2",
      )
      .get() as IdRow
  ).id;

  // v1: published row inserted FIRST so alphabetical/rowid order would pick
  // it — the reviewed row must still win via the explicit CASE ordering.
  // Both ai_assisted=1 to isolate the status tiebreak.
  // v2: draft-only in EN (plus a draft-only DE row to pin
  // getAvailableLanguages). 'unverifiedphrase' must never surface anywhere.
  db.exec(`
    INSERT INTO translations
      (verse_id, lang, translator, translation_text, license, status, ai_assisted)
    VALUES
      (${v1Id}, 'en', 'AI', 'Published: consciousness is the Self.', 'CC-BY-4.0', 'published', 1),
      (${v1Id}, 'en', 'AI-alt', 'Reviewed: consciousness is the Self.',  'CC-BY-4.0', 'reviewed',  1),
      (${v2Id}, 'en', 'AI', 'Draft unverifiedphrase about bondage.', 'CC-BY-4.0', 'draft',     1),
      (${v2Id}, 'de', 'AI', 'Entwurf unverifiedphrase über Bindung.', 'CC-BY-4.0', 'draft',    1)
  `);

  __setDbForTests(db);
});

afterAll(() => {
  __setDbForTests(null);
  db?.close();
});

describe('draft-only verse is invisible in public reads', () => {
  it('getVerse() returns the verse with ZERO translations (Devanagari+IAST intact)', () => {
    const page = getVerse('siva-sutras', 1, 2);
    expect(page).not.toBeNull();
    // Verse body still renders — VerseAnatomy tolerates primaryTranslation=null.
    expect(page!.verse.devanagari).toBe('ज्ञानं बन्धः ॥२॥');
    expect(page!.verse.iast).toBe('jñānaṃ bandhaḥ');
    expect(page!.translations).toHaveLength(0);
  });

  it('getVerse() never returns rows with status=draft', () => {
    const page = getVerse('siva-sutras', 1, 1);
    expect(page!.translations.length).toBeGreaterThan(0);
    expect(page!.translations.every((t) => t.status !== 'draft')).toBe(true);
  });

  it('listChapterSummary() leaves the snippet null for a draft-only verse', () => {
    const rows = listChapterSummary('siva-sutras', 1);
    const v2 = rows.find((r) => r.verse_num === 2);
    expect(v2).toBeDefined();
    expect(v2!.devanagari).toBe('ज्ञानं बन्धः ॥२॥');
    expect(v2!.translation_text).toBeNull();
    expect(v2!.translation_first_clause).toBeNull();
    expect(v2!.translation_lang).toBeNull();
  });

  it('getVerseAllLanguages() omits draft-only languages from translations_by_lang', () => {
    const bundle = getVerseAllLanguages('siva-sutras', 1, 2);
    expect(bundle).not.toBeNull();
    expect(bundle!.translations_by_lang).toEqual({});
  });

  it('getVerseTranslations() excludes drafts (TranslationDrawer shows "Not yet translated")', () => {
    expect(getVerseTranslations(v2Id)).toHaveLength(0);
  });

  it('getAvailableLanguages() ignores languages with only draft rows', () => {
    const langs = getAvailableLanguages();
    expect(langs.has('en')).toBe(true); // v1 has published/reviewed EN
    expect(langs.has('de')).toBe(false); // DE exists only as a draft
  });
});

describe('draft-only verse is invisible in search', () => {
  it('lexicalSearch() does not match draft translation text', async () => {
    const hits = await lexicalSearch('unverifiedphrase');
    expect(hits).toHaveLength(0);
  });

  it('lexicalSearch() hit on the verse itself carries no draft excerpt', async () => {
    // The verse body (IAST) is public — the hit is fine; the draft
    // translation must not leak through translation_excerpt.
    const hits = await lexicalSearch('bandhaḥ');
    const hit = hits.find((h) => h.verse_num === 2);
    expect(hit).toBeDefined();
    expect(hit!.translation_excerpt).toBeNull();
  });
});

describe('status ordering: reviewed ranks above published', () => {
  it('getVerse() puts the reviewed row first', () => {
    const page = getVerse('siva-sutras', 1, 1);
    expect(page!.translations.map((t) => t.status)).toEqual(['reviewed', 'published']);
  });

  it('getVerseTranslations() puts the reviewed row first within a lang', () => {
    const rows = getVerseTranslations(v1Id);
    expect(rows.map((t) => t.status)).toEqual(['reviewed', 'published']);
  });

  it('getVerseAllLanguages() keeps the reviewed row as the per-lang primary', () => {
    const bundle = getVerseAllLanguages('siva-sutras', 1, 1);
    expect(bundle!.translations_by_lang.en!.translation_text).toBe(
      'Reviewed: consciousness is the Self.',
    );
  });

  it('listChapterSummary() snippet comes from the reviewed row', () => {
    const rows = listChapterSummary('siva-sutras', 1);
    const v1 = rows.find((r) => r.verse_num === 1);
    expect(v1!.translation_text).toBe('Reviewed: consciousness is the Self.');
  });
});
