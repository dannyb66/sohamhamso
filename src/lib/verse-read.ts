/**
 * Async verse-page reads for the SSR verse routes (A6 phase 2).
 *
 * WHY THIS FILE EXISTS (separate from `src/lib/db.ts` and
 * `src/lib/seo/corpus-bundle.ts`):
 *   The two verse routes (`/[tradition]/[text]/[chapter]/[verse]` and the
 *   `/[lang]/...` twin) are `prerender = false` — they render at request
 *   time inside the Cloudflare Pages worker, where `bun:sqlite` does not
 *   exist. All reads here go through the `CorpusDb` abstraction
 *   (`src/lib/corpus-db.ts`), which routes to:
 *     - bun:sqlite against `db/sohamhamso.db` in bun (astro dev, tests),
 *     - `@libsql/client/web` against the Turso CORPUS DB in workerd
 *       (env: TURSO_CORPUS_URL + TURSO_CORPUS_AUTH_TOKEN as CF secrets).
 *   Environment detection is the explicit `process.versions.bun` sniff in
 *   corpus-db.ts (`isBunRuntime`) — never an implicit feature probe.
 *
 * LATENCY CONTRACT — ONE batched round-trip per page:
 *   The legacy build-time path (`getVerse()` in db.ts) runs ~6 sequential
 *   queries; that's free against a local file but would cost ~6 sequential
 *   HTTPS exchanges against Turso. `readVersePage()` instead issues a
 *   single `CorpusDb.batch()` of independent statements (each re-derives
 *   the verse id via a subquery, so no statement depends on another's
 *   result) and assembles the full page payload — verse + translations
 *   (all langs) + glosses (all langs) + parallels + prev/next + chapter
 *   count + language availability + per-text lemma occurrence counts —
 *   from that one exchange. The only other round-trip is the corpus-wide
 *   lemma index (slug + occurrence count per lemma), which is memoized at
 *   module scope: the corpus only changes on deploy, so one query per
 *   worker isolate is correct.
 *
 * Draft-visibility promise: identical to db.ts — `status IN ('published',
 * 'reviewed')` everywhere; drafts never reach public reads.
 */

import { SLUG_ALIASES } from './aliases';
import { type CorpusBatchStatement, type CorpusDb, getCorpusDb } from './corpus-db';
import type { Parallel, Text, Translation, Verse, WordGloss } from './db';
import { assignLemmaSlug } from './seo/slug';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal text identity used for alias/tradition resolution. */
export interface TextRef {
  slug: string;
  tradition: string;
}

/** Per-language gloss entry — shape-compatible with getVerseAllLanguages(). */
export interface GlossByLangEntry {
  word_idx: number;
  word_sa: string;
  lemma_iast: string | null;
  gloss_text: string;
  morph: string | null;
}

/** Primary translation per language — shape-compatible with getVerseAllLanguages(). */
export interface TranslationByLangEntry {
  lang: string;
  translation_text: string;
  translator: string | null;
  ai_assisted: boolean;
}

/** Corpus-wide lemma summary (slug + how many verses use the lemma). */
export interface LemmaRef {
  slug: string;
  occurrenceCount: number;
}

export interface VersePageBundle {
  text: Text;
  verse: Verse;
  /** Published/reviewed translations in the requested lang (primary first). */
  translations: Translation[];
  /** Published/reviewed translations across ALL langs (TranslationDrawer). */
  allTranslations: Translation[];
  /** Word glosses in the requested lang, word_idx ASC. */
  wordGlosses: WordGloss[];
  /** All-language gloss bundle (ReaderLangSwap payload). */
  glossesByLang: Record<string, GlossByLangEntry[]>;
  /** First published/reviewed translation per language (ReaderLangSwap). */
  translationsByLang: Record<string, TranslationByLangEntry>;
  parallels: Parallel[];
  prev: { chapter: number; verse_num: number } | null;
  next: { chapter: number; verse_num: number } | null;
  /** Verse count of this chapter (chrome "5.22 / 142" denominator). */
  chapterVerseCount: number | null;
  /** Langs with ≥1 published/reviewed translation for THIS verse (+ 'en'). */
  availability: string[];
  /** Per-lemma count of OTHER verses in this text using the lemma. */
  occurrenceCounts: Map<string, number>;
  /** Corpus-wide lemma summaries for the lemmas in this verse's glosses. */
  lemmaSummaries: Map<string, LemmaRef>;
}

export interface VersePageRead {
  /** All texts (slug + tradition) — drives alias/tradition resolution. */
  texts: TextRef[];
  /** Full page payload, or null when the verse ref doesn't exist. */
  bundle: VersePageBundle | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run a statement list through `db.batch()` when the backend provides it
 * (both real backends do), falling back to parallel `all()` calls for
 * injected test fakes that only implement the minimal CorpusDb surface.
 */
export async function corpusBatch(
  db: CorpusDb,
  stmts: ReadonlyArray<CorpusBatchStatement>,
): Promise<Array<Array<Record<string, unknown>>>> {
  if (typeof db.batch === 'function') {
    return db.batch(stmts);
  }
  return Promise.all(stmts.map((s) => db.all<Record<string, unknown>>(s.sql, s.args ?? [])));
}

// ─────────────────────────────────────────────────────────────────────────────
// Lemma index (memoized — one corpus-wide query per worker isolate)
// ─────────────────────────────────────────────────────────────────────────────

let _lemmaIndexPromise: Promise<Map<string, LemmaRef>> | null = null;

/**
 * Corpus-wide lemma_iast → {slug, occurrenceCount} map. Slug assignment
 * MUST mirror `corpus-bundle.ts:ensureLemmaIndex()` exactly (same seed
 * query, same `MIN(verse_id)` ordering, same `assignLemmaSlug` collision
 * walk) so SSR verse pages link to the same `/lemma/{slug}` URLs the
 * static lemma pages were built under.
 */
async function getLemmaIndexByIast(db: CorpusDb): Promise<Map<string, LemmaRef>> {
  if (_lemmaIndexPromise === null) {
    _lemmaIndexPromise = (async () => {
      const rows = await db.all<{
        lemma_iast: string;
        occurrence_count: number;
      }>(`
        SELECT
          g.lemma_iast,
          COUNT(DISTINCT g.verse_id) AS occurrence_count
        FROM word_glosses g
        WHERE g.lemma_iast IS NOT NULL
          AND TRIM(g.lemma_iast) != ''
        GROUP BY g.lemma_iast
        ORDER BY MIN(g.verse_id) ASC, g.lemma_iast ASC
      `);
      const index = new Map<string, LemmaRef>();
      const seen = new Set<string>();
      for (const row of rows) {
        const slug = assignLemmaSlug(row.lemma_iast, seen);
        seen.add(slug);
        index.set(row.lemma_iast, { slug, occurrenceCount: row.occurrence_count });
      }
      return index;
    })();
    // Don't memoize a rejection — a transient Turso failure must not
    // poison every later request on this isolate.
    _lemmaIndexPromise.catch(() => {
      _lemmaIndexPromise = null;
    });
  }
  return _lemmaIndexPromise;
}

/** Test hook — clears the memoized lemma index. */
export function __resetVerseReadCachesForTests(): void {
  _lemmaIndexPromise = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Alias resolution (params-only; mirrors src/lib/aliases.ts:resolveAlias)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a (tradition, textSlug) URL pair against the texts list from the
 * SAME batch read. Logic mirrors `aliases.ts:resolveAlias()` — kept local
 * because that function's default parameter reaches `listTexts()` →
 * `bun:sqlite`; `SLUG_ALIASES` (the curated map, single source of truth)
 * is still imported from aliases.ts.
 *
 * Returns null for an unknown text (genuine 404), `{ canonical: true }`
 * when params already match, or the canonical pair to 301 to. The
 * build-time `public/_redirects` wildcards (scripts/seo-build-redirects.ts)
 * cover the same alias surface at the CDN; this is the worker-side mirror
 * for anything that reaches the function (e.g. astro dev, cache misses on
 * pairs the wildcards don't enumerate).
 */
export function resolveVerseAlias(
  tradition: string,
  textSlug: string,
  texts: ReadonlyArray<TextRef>,
): { canonical: boolean; canonicalTradition: string; canonicalSlug: string } | null {
  const canonicalSlug = SLUG_ALIASES[textSlug] ?? textSlug;
  const t = texts.find((x) => x.slug === canonicalSlug);
  if (!t) return null;
  return {
    canonical: t.tradition === tradition && t.slug === textSlug,
    canonicalTradition: t.tradition,
    canonicalSlug: t.slug,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The batched verse-page read
// ─────────────────────────────────────────────────────────────────────────────

/** Subquery resolving the verse id from (slug, chapter, verse_num) params. */
const VERSE_ID_SQL = `(
  SELECT v2.id FROM verses v2
  JOIN texts t2 ON t2.id = v2.text_id
  WHERE t2.slug = ? AND v2.chapter = ? AND v2.verse_num = ?
)`;

/** Subquery resolving the text id from the slug param. */
const TEXT_ID_SQL = '(SELECT t2.id FROM texts t2 WHERE t2.slug = ?)';

/**
 * Fetch everything the verse page needs in ONE CorpusDb round-trip, plus
 * the memoized lemma index. Statements are independent (each re-resolves
 * ids via subqueries) so they can ride a single libsql `batch()`.
 *
 * Returns `{ texts, bundle: null }` when the verse ref doesn't resolve —
 * `texts` still lets the caller distinguish alias-redirect from 404.
 *
 * Throws on transport/config failure (CorpusNotConfiguredError, network);
 * callers map that to the styled 503.
 */
export async function readVersePage(
  textSlug: string,
  chapter: number,
  verseNum: number,
  lang = 'en',
): Promise<VersePageRead> {
  const db = await getCorpusDb();
  const vid: ReadonlyArray<string | number> = [textSlug, chapter, verseNum];

  const stmts: CorpusBatchStatement[] = [
    // 0 — all texts (alias/tradition resolution)
    { sql: 'SELECT slug, tradition FROM texts' },
    // 1 — text row
    { sql: 'SELECT * FROM texts WHERE slug = ? LIMIT 1', args: [textSlug] },
    // 2 — verse row
    {
      sql: `
        SELECT v.* FROM verses v
        JOIN texts t ON t.id = v.text_id
        WHERE t.slug = ? AND v.chapter = ? AND v.verse_num = ?
        LIMIT 1`,
      args: [...vid],
    },
    // 3 — ALL published/reviewed translations, every lang. Ordering puts
    //     the primary row first per lang (reviewed → human → oldest), so
    //     this one result derives: requested-lang list, drawer payload,
    //     translations_by_lang, and availability.
    {
      sql: `
        SELECT * FROM translations
        WHERE verse_id = ${VERSE_ID_SQL}
          AND status IN ('published', 'reviewed')
        ORDER BY lang ASC, CASE status WHEN 'reviewed' THEN 0 ELSE 1 END,
          ai_assisted ASC, created_at ASC`,
      args: [...vid],
    },
    // 4 — ALL word glosses, every lang (requested-lang slice + ReaderLangSwap).
    {
      sql: `
        SELECT * FROM word_glosses
        WHERE verse_id = ${VERSE_ID_SQL}
        ORDER BY gloss_lang ASC, word_idx ASC`,
      args: [...vid],
    },
    // 5 — parallels with joined target summary (mirrors db.ts getVerse()).
    {
      sql: `
        SELECT
          p.id, p.source_verse_id, p.target_verse_id, p.citation_type,
          p.confidence, p.extracted_by,
          tt.slug AS target_text_slug,
          tt.title_en AS target_text_title,
          tv.chapter AS target_chapter,
          tv.verse_num AS target_verse_num,
          tv.devanagari AS target_devanagari,
          tv.iast AS target_iast
        FROM parallels p
        JOIN verses tv ON tv.id = p.target_verse_id
        JOIN texts tt ON tt.id = tv.text_id
        WHERE p.source_verse_id = ${VERSE_ID_SQL}
        ORDER BY p.confidence DESC NULLS LAST`,
      args: [...vid],
    },
    // 6 — prev cursor
    {
      sql: `
        SELECT v.chapter, v.verse_num FROM verses v
        WHERE v.text_id = ${TEXT_ID_SQL}
          AND (v.chapter < ? OR (v.chapter = ? AND v.verse_num < ?))
        ORDER BY v.chapter DESC, v.verse_num DESC
        LIMIT 1`,
      args: [textSlug, chapter, chapter, verseNum],
    },
    // 7 — next cursor
    {
      sql: `
        SELECT v.chapter, v.verse_num FROM verses v
        WHERE v.text_id = ${TEXT_ID_SQL}
          AND (v.chapter > ? OR (v.chapter = ? AND v.verse_num > ?))
        ORDER BY v.chapter ASC, v.verse_num ASC
        LIMIT 1`,
      args: [textSlug, chapter, chapter, verseNum],
    },
    // 8 — chapter verse count (position-indicator denominator)
    {
      sql: `
        SELECT COUNT(*) AS n FROM verses v
        JOIN texts t ON t.id = v.text_id
        WHERE t.slug = ? AND v.chapter = ?`,
      args: [textSlug, chapter],
    },
    // 9 — per-text occurrence counts for this verse's lemmas (WordSheet
    //     "N more occurrences" link), excluding the current verse.
    {
      sql: `
        SELECT g.lemma_iast AS lemma_iast, COUNT(DISTINCT g.verse_id) AS n
        FROM word_glosses g
        JOIN verses v ON v.id = g.verse_id
        WHERE v.text_id = ${TEXT_ID_SQL}
          AND g.verse_id != ${VERSE_ID_SQL}
          AND g.lemma_iast IN (
            SELECT g2.lemma_iast FROM word_glosses g2
            WHERE g2.verse_id = ${VERSE_ID_SQL}
              AND g2.lemma_iast IS NOT NULL
          )
        GROUP BY g.lemma_iast`,
      args: [textSlug, ...vid, ...vid],
    },
  ];

  const [
    textRows,
    textRowRows,
    verseRows,
    translationRows,
    glossRows,
    parallelRows,
    prevRows,
    nextRows,
    chapterCountRows,
    occurrenceRows,
  ] = await corpusBatch(db, stmts);

  const texts = textRows as unknown as TextRef[];
  const text = (textRowRows[0] as unknown as Text) ?? null;
  const verse = (verseRows[0] as unknown as Verse) ?? null;
  if (!text || !verse) {
    return { texts, bundle: null };
  }

  type RawTranslation = Omit<Translation, 'ai_assisted'> & { ai_assisted: number };
  const allTranslations: Translation[] = (translationRows as unknown as RawTranslation[]).map(
    (t) => ({ ...t, ai_assisted: t.ai_assisted === 1 }),
  );
  // Primary slice = the requested language. FALLBACK: when the requested
  // language has no published translation for this verse but other languages
  // do (a real gap in some Phase-1 verses — e.g. an EN canonical URL for a
  // verse that only has Hindi), surface the best-available language so the
  // page never renders a translation-less void. Priority keeps EN first, then
  // the most widely-covered Indic scripts. The TranslationDrawer / locale
  // mirrors still expose every available language for switching.
  let translations = allTranslations.filter((t) => t.lang === lang);
  if (translations.length === 0 && allTranslations.length > 0) {
    const available = new Set(allTranslations.map((t) => t.lang));
    const FALLBACK_LANG_ORDER = [
      'en', 'hi', 'bn', 'ta', 'te', 'kn', 'ml', 'mr', 'gu', 'pa', 'or', 'as',
    ];
    const fallbackLang =
      FALLBACK_LANG_ORDER.find((l) => available.has(l)) ?? allTranslations[0].lang;
    translations = allTranslations.filter((t) => t.lang === fallbackLang);
  }

  const allGlosses = glossRows as unknown as WordGloss[];
  const wordGlosses = allGlosses.filter((g) => g.gloss_lang === lang);

  const glossesByLang: Record<string, GlossByLangEntry[]> = {};
  for (const g of allGlosses) {
    let list = glossesByLang[g.gloss_lang];
    if (!list) {
      list = [];
      glossesByLang[g.gloss_lang] = list;
    }
    list.push({
      word_idx: g.word_idx,
      word_sa: g.word_sa,
      lemma_iast: g.lemma_iast,
      gloss_text: g.gloss_text,
      morph: g.morph,
    });
  }

  // First row per lang is the primary one (ordering in stmt 3).
  const translationsByLang: Record<string, TranslationByLangEntry> = {};
  for (const t of allTranslations) {
    if (translationsByLang[t.lang]) continue;
    translationsByLang[t.lang] = {
      lang: t.lang,
      translation_text: t.translation_text,
      translator: t.translator,
      ai_assisted: t.ai_assisted,
    };
  }

  // Availability mirrors seo/corpus-bundle.ts:getVerseAvailability().
  const availability = Object.keys(translationsByLang).sort();
  if (!availability.includes('en')) availability.unshift('en');

  const occurrenceCounts = new Map<string, number>();
  for (const row of occurrenceRows as unknown as Array<{ lemma_iast: string; n: number }>) {
    occurrenceCounts.set(row.lemma_iast, row.n);
  }

  // Lemma summaries for just this verse's lemmas (memoized corpus index).
  const lemmaSummaries = new Map<string, LemmaRef>();
  const verseLemmas = new Set(allGlosses.map((g) => g.lemma_iast).filter((s): s is string => !!s));
  if (verseLemmas.size > 0) {
    const index = await getLemmaIndexByIast(db);
    for (const lemma of verseLemmas) {
      const entry = index.get(lemma);
      if (entry) lemmaSummaries.set(lemma, entry);
    }
  }

  const prevRow = (prevRows[0] as unknown as { chapter: number; verse_num: number }) ?? null;
  const nextRow = (nextRows[0] as unknown as { chapter: number; verse_num: number }) ?? null;
  const chapterCount = (chapterCountRows[0] as unknown as { n: number }) ?? null;

  return {
    texts,
    bundle: {
      text,
      verse,
      translations,
      allTranslations,
      wordGlosses,
      glossesByLang,
      translationsByLang,
      parallels: parallelRows as unknown as Parallel[],
      prev: prevRow,
      next: nextRow,
      chapterVerseCount: chapterCount?.n ?? null,
      availability,
      occurrenceCounts,
      lemmaSummaries,
    },
  };
}
