/**
 * Unit tests for `src/lib/verse-read.ts` — the batched async verse-page
 * read that powers the SSR verse routes (A6 phase 2).
 *
 * Strategy:
 *   - In-memory bun:sqlite DB seeded with the production schema
 *     (`db/schema.sql`) + a small fixture.
 *   - The same seeded Database is exposed two ways:
 *       1. injected into db.ts via `__setDbForTests` so the legacy sync
 *          reader (`getVerse`) reads it — the PARITY oracle;
 *       2. wrapped in a fake `CorpusDb` injected via
 *          `__setCorpusDbForTests` so `readVersePage()` reads it through
 *          the same abstraction the worker uses.
 *   - Parity specs assert the batched read returns the exact same page
 *     payload the build-time path produced, so the SSR migration cannot
 *     silently change rendered content.
 *
 * Run with: `bun --bun vitest run tests/unit/verse-read.test.ts`
 */

import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildLemmaIndex } from '../../pipeline/ingest/lemma-index';
import { type CorpusDb, __setCorpusDbForTests } from '../../src/lib/corpus-db';
import { __setDbForTests, getVerse } from '../../src/lib/db';
import {
  __resetVerseReadCachesForTests,
  corpusBatch,
  readVersePage,
  resolveVerseAlias,
} from '../../src/lib/verse-read';

const SCHEMA_PATH = resolve(__dirname, '..', '..', 'db', 'schema.sql');

let db: Database;

/** Fake CorpusDb over the seeded bun:sqlite DB. */
function makeFakeCorpusDb(database: Database, withBatch: boolean): CorpusDb {
  const base: CorpusDb = {
    async all<T>(sql: string, params: ReadonlyArray<string | number | null> = []): Promise<T[]> {
      // biome-ignore lint/suspicious/noExplicitAny: test adapter
      return database.query<T, any>(sql).all(...(params as any[])) as T[];
    },
    async get<T>(
      sql: string,
      params: ReadonlyArray<string | number | null> = [],
    ): Promise<T | undefined> {
      // biome-ignore lint/suspicious/noExplicitAny: test adapter
      return (database.query<T, any>(sql).get(...(params as any[])) as T | null) ?? undefined;
    },
  };
  if (withBatch) {
    // Sequential like the real bun backend — order preserved.
    base.batch = (stmts) =>
      Promise.all(stmts.map((s) => base.all<Record<string, unknown>>(s.sql, s.args ?? [])));
  }
  return base;
}

beforeAll(() => {
  db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));

  db.exec(`
    INSERT INTO texts (id, slug, title_sa, title_en, title_iast, tradition, school, license)
    VALUES
      ('siva-sutras', 'siva-sutras', 'शिवसूत्राणि', 'Śiva Sūtras', 'Śivasūtrāṇi',
       'trika', 'kashmir-shaivism', 'CC-BY-4.0'),
      ('karpuradi-stotra', 'karpuradi-stotra', 'कर्पूरादिस्तोत्र', 'Karpūrādi Stotra', NULL,
       'shakta', NULL, 'CC-BY-4.0');
  `);

  // Three verses in chapter 1 + one in chapter 2 (prev/next + count).
  db.exec(`
    INSERT INTO verses (text_id, chapter, verse_num, devanagari, iast)
    VALUES
      ('siva-sutras', 1, 1, 'चैतन्यमात्मा ॥१॥', 'caitanyam ātmā'),
      ('siva-sutras', 1, 2, 'ज्ञानं बन्धः ॥२॥', 'jñānaṃ bandhaḥ'),
      ('siva-sutras', 1, 3, 'योनिवर्गः कलाशरीरम् ॥३॥', 'yonivargaḥ kalāśarīram'),
      ('siva-sutras', 2, 1, 'चित्तं मन्त्रः ॥१॥', 'cittaṃ mantraḥ'),
      ('karpuradi-stotra', 1, 1, 'कर्पूरमध्य…', 'karpūramadhya…');
  `);

  const vid = (ch: number, v: number): number =>
    (
      db
        .query<{ id: number }, [number, number]>(
          "SELECT id FROM verses WHERE text_id='siva-sutras' AND chapter=? AND verse_num=?",
        )
        .get(ch, v) as { id: number }
    ).id;
  const v11 = vid(1, 1);
  const v12 = vid(1, 2);
  const v21 = vid(2, 1);

  // Translations: en (published, AI) + en (reviewed, human) + hi
  // (published) + a DRAFT that must never surface.
  db.exec(`
    INSERT INTO translations (verse_id, lang, translator, translation_text, license, status, ai_assisted)
    VALUES
      (${v11}, 'en', 'claude', 'Consciousness is the Self (AI).', 'CC-BY-4.0', 'published', 1),
      (${v11}, 'en', 'human-reviewer', 'Consciousness is the Self.', 'CC-BY-4.0', 'reviewed', 0),
      (${v11}, 'hi', 'claude', 'चैतन्य ही आत्मा है।', 'CC-BY-4.0', 'published', 1),
      (${v11}, 'ta', 'claude', 'DRAFT ONLY — must not surface', 'CC-BY-4.0', 'draft', 1),
      (${v12}, 'en', 'claude', 'Knowledge is bondage.', 'CC-BY-4.0', 'published', 1);
  `);

  // Glosses: 'caitanya' appears in verses 1.1 AND 1.2 AND 2.1 (occurrence
  // count 2 from 1.1's perspective); 'ātman' only in 1.1.
  db.exec(`
    INSERT INTO word_glosses (verse_id, word_idx, word_sa, lemma_sa, lemma_iast, gloss_lang, gloss_text, morph)
    VALUES
      (${v11}, 0, 'चैतन्यम्', 'चैतन्य', 'caitanya', 'en', 'consciousness', 'n. nom. sg.'),
      (${v11}, 1, 'आत्मा', 'आत्मन्', 'ātman', 'en', 'the Self', 'm. nom. sg.'),
      (${v11}, 0, 'चैतन्यम्', 'चैतन्य', 'caitanya', 'hi', 'चैतन्य', 'n. nom. sg.'),
      (${v12}, 0, 'ज्ञानम्', 'ज्ञान', 'caitanya', 'en', 'knowledge', 'n. nom. sg.'),
      (${v21}, 0, 'चित्तम्', 'चित्त', 'caitanya', 'en', 'mind', 'n. nom. sg.');
  `);

  db.exec(`
    INSERT INTO parallels (source_verse_id, target_verse_id, citation_type, confidence, extracted_by)
    VALUES (${v11}, ${v12}, 'echo', 0.9, 'test');
  `);

  // Materialize lemma_index exactly as the build pipeline does, so the SSR
  // read resolves lemma summaries from the table (not a word_glosses scan).
  buildLemmaIndex(db);

  __setDbForTests(db);
});

afterAll(() => {
  __setDbForTests(null);
  __setCorpusDbForTests(null);
  __resetVerseReadCachesForTests();
});

describe('readVersePage — batched SSR read', () => {
  it('matches the legacy sync getVerse() payload (parity oracle)', async () => {
    __setCorpusDbForTests(makeFakeCorpusDb(db, true));
    __resetVerseReadCachesForTests();

    const legacy = getVerse('siva-sutras', 1, 1, 'en');
    const { bundle } = await readVersePage('siva-sutras', 1, 1, 'en');

    expect(legacy).not.toBeNull();
    expect(bundle).not.toBeNull();
    expect(bundle?.text).toEqual(legacy?.text);
    expect(bundle?.verse).toEqual(legacy?.verse);
    expect(bundle?.translations).toEqual(legacy?.translations);
    expect(bundle?.wordGlosses).toEqual(legacy?.wordGlosses);
    expect(bundle?.parallels).toEqual(legacy?.parallels);
    expect(bundle?.prev).toEqual(legacy?.prev);
    expect(bundle?.next).toEqual(legacy?.next);
  });

  it('orders the requested-lang translations primary-first (reviewed > published)', async () => {
    __setCorpusDbForTests(makeFakeCorpusDb(db, true));
    const { bundle } = await readVersePage('siva-sutras', 1, 1, 'en');
    expect(bundle?.translations[0]?.status).toBe('reviewed');
    expect(bundle?.translations[0]?.translation_text).toBe('Consciousness is the Self.');
  });

  it('excludes drafts everywhere (availability, drawer payload, by-lang map)', async () => {
    __setCorpusDbForTests(makeFakeCorpusDb(db, true));
    const { bundle } = await readVersePage('siva-sutras', 1, 1, 'en');
    expect(bundle?.availability).toEqual(['en', 'hi']);
    expect(bundle?.allTranslations.some((t) => t.status === 'draft')).toBe(false);
    expect(bundle?.translationsByLang.ta).toBeUndefined();
    expect(bundle?.translationsByLang.hi?.translation_text).toBe('चैतन्य ही आत्मा है।');
  });

  it('builds the all-language gloss bundle + chapter count + occurrence counts', async () => {
    __setCorpusDbForTests(makeFakeCorpusDb(db, true));
    const { bundle } = await readVersePage('siva-sutras', 1, 1, 'en');
    expect(Object.keys(bundle?.glossesByLang ?? {}).sort()).toEqual(['en', 'hi']);
    expect(bundle?.glossesByLang.en).toHaveLength(2);
    expect(bundle?.chapterVerseCount).toBe(3);
    // 'caitanya' appears in 2 OTHER verses of this text (1.2 and 2.1).
    expect(bundle?.occurrenceCounts.get('caitanya')).toBe(2);
    expect(bundle?.occurrenceCounts.has('ātman')).toBe(false);
  });

  it('resolves corpus-wide lemma summaries (slug + occurrence count)', async () => {
    __setCorpusDbForTests(makeFakeCorpusDb(db, true));
    __resetVerseReadCachesForTests();
    const { bundle } = await readVersePage('siva-sutras', 1, 1, 'en');
    const caitanya = bundle?.lemmaSummaries.get('caitanya');
    expect(caitanya?.occurrenceCount).toBe(3);
    expect(caitanya?.slug).toBe('caitanya');
    expect(bundle?.lemmaSummaries.get('ātman')?.occurrenceCount).toBe(1);
  });

  it('reads lemma summaries from lemma_index, not by scanning word_glosses', async () => {
    // Sentinel: overwrite the materialized row with values a glosses-scan
    // could never produce. If the read still returns these, it came from
    // lemma_index (the whole point of the read-quota fix).
    db.exec(
      "UPDATE lemma_index SET slug = 'caitanya-sentinel', occurrence_count = 99 WHERE lemma_iast = 'caitanya'",
    );
    __setCorpusDbForTests(makeFakeCorpusDb(db, true));
    __resetVerseReadCachesForTests();
    const { bundle } = await readVersePage('siva-sutras', 1, 1, 'en');
    const caitanya = bundle?.lemmaSummaries.get('caitanya');
    expect(caitanya?.slug).toBe('caitanya-sentinel');
    expect(caitanya?.occurrenceCount).toBe(99);
    // Restore so later specs (any order) see the real materialized value.
    buildLemmaIndex(db);
  });

  it('returns texts + null bundle for a missing verse ref', async () => {
    __setCorpusDbForTests(makeFakeCorpusDb(db, true));
    const read = await readVersePage('siva-sutras', 9, 9, 'en');
    expect(read.bundle).toBeNull();
    expect(read.texts.map((t) => t.slug).sort()).toEqual(['karpuradi-stotra', 'siva-sutras']);
  });

  it('works without a batch() impl (sequential fallback for minimal fakes)', async () => {
    __setCorpusDbForTests(makeFakeCorpusDb(db, false));
    __resetVerseReadCachesForTests();
    const { bundle } = await readVersePage('siva-sutras', 1, 2, 'en');
    expect(bundle?.verse.verse_num).toBe(2);
    expect(bundle?.prev).toEqual({ chapter: 1, verse_num: 1 });
    expect(bundle?.next).toEqual({ chapter: 1, verse_num: 3 });
  });
});

describe('corpusBatch helper', () => {
  it('prefers the backend batch() and preserves statement order', async () => {
    let batchCalls = 0;
    const fake = makeFakeCorpusDb(db, true);
    const origBatch = fake.batch?.bind(fake);
    if (!origBatch) throw new Error('fake should expose batch');
    fake.batch = async (stmts) => {
      batchCalls += 1;
      return origBatch(stmts);
    };
    const [a, b] = await corpusBatch(fake, [
      { sql: 'SELECT COUNT(*) AS n FROM texts' },
      { sql: 'SELECT slug FROM texts WHERE tradition = ?', args: ['trika'] },
    ]);
    expect(batchCalls).toBe(1);
    expect((a[0] as { n: number }).n).toBe(2);
    expect((b[0] as { slug: string }).slug).toBe('siva-sutras');
  });
});

describe('resolveVerseAlias — params-only alias resolution', () => {
  const texts = [
    { slug: 'siva-sutras', tradition: 'trika' },
    { slug: 'karpuradi-stotra', tradition: 'shakta' },
  ];

  it('passes canonical pairs through', () => {
    expect(resolveVerseAlias('trika', 'siva-sutras', texts)).toEqual({
      canonical: true,
      canonicalTradition: 'trika',
      canonicalSlug: 'siva-sutras',
    });
  });

  it('redirects wrong-tradition URLs', () => {
    expect(resolveVerseAlias('shaiva', 'siva-sutras', texts)).toEqual({
      canonical: false,
      canonicalTradition: 'trika',
      canonicalSlug: 'siva-sutras',
    });
  });

  it('redirects curated slug aliases (SLUG_ALIASES is the single source)', () => {
    expect(resolveVerseAlias('trika', 'shiva-sutras', texts)).toEqual({
      canonical: false,
      canonicalTradition: 'trika',
      canonicalSlug: 'siva-sutras',
    });
    expect(resolveVerseAlias('trika', 'karpuradi-stotram', texts)).toEqual({
      canonical: false,
      canonicalTradition: 'shakta',
      canonicalSlug: 'karpuradi-stotra',
    });
  });

  it('returns null for unknown texts (genuine 404)', () => {
    expect(resolveVerseAlias('trika', 'no-such-text', texts)).toBeNull();
  });
});
