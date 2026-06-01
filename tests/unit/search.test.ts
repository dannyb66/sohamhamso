// biome-ignore lint/correctness/noUndeclaredDependencies: bun built-in
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
/**
 * Unit tests for `src/lib/search.ts`.
 *
 * Strategy:
 *   - Open an in-memory SQLite DB via `bun:sqlite`.
 *   - Apply the production schema (verses + translations + verse_embeddings).
 *   - Seed a small fixture so lexical queries have something to match.
 *   - Inject the DB via `__setDbForTests`.
 *
 * Module-level state in search.ts:
 *   - `_ftsAvailable` is cached once. We seed without a `verses_fts` table,
 *     so it locks to `false` and the LIKE fallback runs throughout.
 *   - `_openai` is cached when first non-null. We unset `OPENAI_API_KEY`
 *     in `beforeAll` so `getOpenAI()` returns null and `semanticSearch`
 *     short-circuits to [] — driving the "no embeddings → lexical-only"
 *     blendedSearch path that's explicitly speced.
 *
 * For RRF fusion tests where both engines must return overlapping verse_ids,
 * we mock the `openai` module to return a deterministic embedding, then
 * seed `verse_embeddings` with matching vectors. Cosine score is dot-product
 * on L2-normalized vectors.
 *
 * Run with: `bun --bun vitest run tests/unit/search.test.ts`
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// ── OpenAI mock ───────────────────────────────────────────────────────────
// Default mock: returns a fixed unit-norm 3072-dim vector aligned with the
// "siva-sutras 1.1" verse embedding we seed below. Tests that don't set
// OPENAI_API_KEY won't reach this code path (semantic returns [] early).
const FAKE_DIMS = 3072;
function unitVecAt(idx: number): Float32Array {
  // One-hot vector at `idx`, then re-normalized (trivially unit-norm).
  const v = new Float32Array(FAKE_DIMS);
  v[idx % FAKE_DIMS] = 1;
  return v;
}

vi.mock('openai', () => {
  class FakeOpenAI {
    embeddings = {
      create: async ({ input }: { input: string }) => {
        // Map query → fixed verse index. "caitanya..." aligns with idx 0;
        // "jnana..." aligns with idx 1; everything else aligns with idx 0.
        const lower = String(input).toLowerCase();
        const idx =
          lower.includes('jñāna') || lower.includes('jnana') || lower.includes('bandh') ? 1 : 0;
        return {
          data: [{ embedding: Array.from(unitVecAt(idx)) }],
        };
      },
    };
  }
  return { default: FakeOpenAI };
});

// ─────────────────────────────────────────────────────────────────────────
// Schema + seed
// ─────────────────────────────────────────────────────────────────────────
const SCHEMA_PATH = resolve(__dirname, '..', '..', 'db', 'schema.sql');

let db: Database;
let sivaV1Id: number;
let sivaV2Id: number;
let spandaV1Id: number;

// Pack a Float32Array → little-endian Buffer the same way better-sqlite3 BLOBs
// round-trip via `bun:sqlite`. The `bufferToFloat32()` helper in search.ts
// expects the BLOB layout `Buffer.from(f32.buffer)`.
function f32ToBuf(f: Float32Array): Buffer {
  return Buffer.from(f.buffer, f.byteOffset, f.byteLength);
}

beforeAll(async () => {
  // Ensure semanticSearch goes through the lexical-only branch by default
  // (no key) — individual tests set/unset as needed but the module-scope
  // `_openai` lazy-inits only when a key is present.
  delete process.env.OPENAI_API_KEY;

  db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));

  db.exec(`
    INSERT INTO texts (id, slug, title_sa, title_en, title_iast, tradition, license)
    VALUES
      ('siva-sutras', 'siva-sutras', 'शिवसूत्राणि', 'Śiva Sūtras', 'Śivasūtrāṇi',
       'trika', 'CC-BY-4.0'),
      ('spanda-karikas', 'spanda-karikas', 'स्पन्दकारिका', 'Spanda Kārikās', 'Spandakārikā',
       'trika', 'CC-BY-4.0');
  `);

  db.exec(`
    INSERT INTO verses (text_id, chapter, verse_num, devanagari, iast)
    VALUES
      ('siva-sutras',    1, 1, 'चैतन्यमात्मा ॥१॥', 'caitanyam ātmā'),
      ('siva-sutras',    1, 2, 'ज्ञानं बन्धः ॥२॥', 'jñānaṃ bandhaḥ'),
      ('spanda-karikas', 1, 1, 'यस्योन्मेषनिमेषाभ्याम् ।', 'yasyonmeṣanimeṣābhyām');
  `);

  type IdRow = { id: number };
  sivaV1Id = (
    db
      .query<IdRow, []>(
        "SELECT id FROM verses WHERE text_id='siva-sutras' AND chapter=1 AND verse_num=1",
      )
      .get() as IdRow
  ).id;
  sivaV2Id = (
    db
      .query<IdRow, []>(
        "SELECT id FROM verses WHERE text_id='siva-sutras' AND chapter=1 AND verse_num=2",
      )
      .get() as IdRow
  ).id;
  spandaV1Id = (
    db
      .query<IdRow, []>(
        "SELECT id FROM verses WHERE text_id='spanda-karikas' AND chapter=1 AND verse_num=1",
      )
      .get() as IdRow
  ).id;

  db.exec(`
    INSERT INTO translations
      (verse_id, lang, translator, translation_text, license, status, ai_assisted)
    VALUES
      (${sivaV1Id},   'en', 'PD',  'Consciousness is the Self.',              'PD', 'published', 0),
      (${sivaV2Id},   'en', 'PD',  'Limited knowledge is bondage.',           'PD', 'published', 0),
      (${spandaV1Id}, 'en', 'PD',  'By whose opening and closing of the eyes…', 'PD', 'published', 0)
  `);

  // Seed embeddings used by the RRF/dedup tests. The fake OpenAI returns
  // a one-hot vector at idx 0 for generic queries; we plant matching vectors
  // on siva 1.1 (also idx 0) so cosine ≈ 1.0 and it ranks #1 semantically.
  // siva 1.2 gets a different one-hot so it never collides.
  const ins = db.prepare(
    'INSERT INTO verse_embeddings (verse_id, lang, embedding, model) VALUES (?, ?, ?, ?)',
  );
  ins.run(sivaV1Id, 'en', f32ToBuf(unitVecAt(0)), 'text-embedding-3-large');
  ins.run(sivaV2Id, 'en', f32ToBuf(unitVecAt(1)), 'text-embedding-3-large');
  ins.run(spandaV1Id, 'en', f32ToBuf(unitVecAt(2)), 'text-embedding-3-large');

  // Inject into search.ts via the db module's test hook.
  const { __setDbForTests } = await import('../../src/lib/db');
  __setDbForTests(db);
});

afterAll(async () => {
  const { __setDbForTests } = await import('../../src/lib/db');
  __setDbForTests(null);
  db?.close();
  delete process.env.OPENAI_API_KEY;
});

// ─────────────────────────────────────────────────────────────────────────
// lexicalSearch
// ─────────────────────────────────────────────────────────────────────────
describe('lexicalSearch()', () => {
  it('returns hits for verses whose IAST contains the query', async () => {
    const { lexicalSearch } = await import('../../src/lib/search');
    const hits = await lexicalSearch('caitanyam');
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.some((h) => h.verse_id === sivaV1Id)).toBe(true);
    expect(hits.every((h) => h.source === 'lexical')).toBe(true);
  });

  it('is case-insensitive for IAST (LIKE % lowercase % matches mixed case rows)', async () => {
    // The expandSynonyms() normalizer lowercases the query; our seeded
    // iast values are already lowercase. To prove case-insensitivity
    // end-to-end we just upper-case the query — it should still hit.
    const { lexicalSearch } = await import('../../src/lib/search');
    const lower = await lexicalSearch('caitanyam');
    const upper = await lexicalSearch('CAITANYAM');
    expect(upper.map((h) => h.verse_id).sort()).toEqual(lower.map((h) => h.verse_id).sort());
    expect(upper.length).toBeGreaterThan(0);
  });

  it('matches against translations as well as devanagari/iast', async () => {
    const { lexicalSearch } = await import('../../src/lib/search');
    // 'Consciousness' lives in translations.translation_text only.
    const hits = await lexicalSearch('Consciousness');
    expect(hits.some((h) => h.verse_id === sivaV1Id)).toBe(true);
  });

  it('matches against devanagari column', async () => {
    const { lexicalSearch } = await import('../../src/lib/search');
    // 'चैतन्यमात्मा' lives only in verses.devanagari for siva 1.1.
    const hits = await lexicalSearch('चैतन्यमात्मा');
    expect(hits.some((h) => h.verse_id === sivaV1Id)).toBe(true);
  });

  it('returns an empty array for a nonsense query', async () => {
    const { lexicalSearch } = await import('../../src/lib/search');
    const hits = await lexicalSearch('zzzzz-no-such-verse-zzzzz');
    expect(hits).toEqual([]);
  });

  it('returns an empty array for whitespace-only query', async () => {
    const { lexicalSearch } = await import('../../src/lib/search');
    expect(await lexicalSearch('   ')).toEqual([]);
    expect(await lexicalSearch('')).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// blendedSearch — graceful degradation
// ─────────────────────────────────────────────────────────────────────────
describe('blendedSearch() — lexical-only fallback (no OPENAI_API_KEY)', () => {
  it('falls back to lexical results when semanticSearch returns []', async () => {
    // No key set in beforeAll → semanticSearch short-circuits before
    // touching the embeddings table. Result set must equal lexicalSearch's.
    expect(process.env.OPENAI_API_KEY).toBeUndefined();
    const { blendedSearch, lexicalSearch } = await import('../../src/lib/search');
    const blended = await blendedSearch('caitanyam');
    const lex = await lexicalSearch('caitanyam');
    expect(blended.length).toBe(lex.length);
    expect(blended.map((h) => h.verse_id).sort()).toEqual(lex.map((h) => h.verse_id).sort());
    // When falling back, blendedSearch returns the lexical hits verbatim
    // (no re-wrap), so source stays 'lexical'.
    expect(blended.every((h) => h.source === 'lexical')).toBe(true);
  });

  it('returns [] for empty/whitespace query', async () => {
    const { blendedSearch } = await import('../../src/lib/search');
    expect(await blendedSearch('')).toEqual([]);
    expect(await blendedSearch('   ')).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// blendedSearch — RRF fusion + dedup
//
// Activate the mocked OpenAI by setting OPENAI_API_KEY. The mock returns
// a one-hot vector at idx 0 for the generic "caitanyam" query → cosine 1.0
// with siva 1.1 (also idx 0) and ~0 with the others. So siva 1.1 ranks #1
// in BOTH lexical AND semantic.
// ─────────────────────────────────────────────────────────────────────────
describe('blendedSearch() — RRF fusion with both engines live', () => {
  beforeAll(() => {
    process.env.OPENAI_API_KEY = 'sk-test-fake-key-for-mock';
  });

  it('deduplicates hits that appear in both lexical and semantic', async () => {
    const { blendedSearch } = await import('../../src/lib/search');
    const blended = await blendedSearch('caitanyam');
    // siva-sutras 1.1 appears in both legs (lexical match on 'caitanyam',
    // semantic top-1 via the one-hot fake embedding). It must appear once.
    const sivaV1Hits = blended.filter((h) => h.verse_id === sivaV1Id);
    expect(sivaV1Hits, 'siva 1.1 must be deduped').toHaveLength(1);
    // Every blended hit must have a distinct verse_id.
    const ids = blended.map((h) => h.verse_id);
    expect(new Set(ids).size).toBe(ids.length);
    // The deduped hit is re-wrapped as 'blended'.
    expect(sivaV1Hits[0]!.source).toBe('blended');
  });

  it('ranks an overlap-#1 result above a single-engine-#1 result (RRF)', async () => {
    // siva 1.1 = #1 in BOTH engines (RRF score = 2 * 1/(60+1) ≈ 0.0328).
    // spanda 1.1 = appears ONLY in semantic at some rank (since 'caitanyam'
    // is not in its iast/devanagari/translation). With the fake embedding
    // at idx 0 vs idx 2, spanda's cosine is 0, but it still shows up in
    // the full semantic scan ranked last.
    //
    // The load-bearing claim: anything in BOTH lists outranks anything
    // in just ONE list at equal-or-better rank. siva 1.1 (in both, #1)
    // must outrank spanda 1.1 (in one, last).
    const { blendedSearch } = await import('../../src/lib/search');
    const blended = await blendedSearch('caitanyam');

    const sivaIdx = blended.findIndex((h) => h.verse_id === sivaV1Id);
    const spandaIdx = blended.findIndex((h) => h.verse_id === spandaV1Id);

    expect(sivaIdx).toBeGreaterThanOrEqual(0);
    // spanda may or may not surface depending on semantic-leg score ties;
    // if it does, it must rank below siva 1.1. If it doesn't, RRF correctly
    // demoted it off the top-N.
    if (spandaIdx >= 0) {
      expect(sivaIdx).toBeLessThan(spandaIdx);
    }
    expect(blended[0]!.verse_id).toBe(sivaV1Id);
    expect(blended[0]!.source).toBe('blended');
  });

  it('returns [] for empty query even with both engines available', async () => {
    const { blendedSearch } = await import('../../src/lib/search');
    expect(await blendedSearch('')).toEqual([]);
  });
});
