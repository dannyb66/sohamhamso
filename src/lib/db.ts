/**
 * SQLite query helpers for sohamhamso reader.
 *
 * Runtime: Bun (build-time queries during `astro build`).
 * Driver: `bun:sqlite` — Bun's built-in synchronous SQLite driver.
 *
 * All exported functions are PURE reads. No mutation. Prepared statements
 * are cached on the Database instance.
 *
 * Production: this same logical schema lives in Turso libSQL (corpus DB).
 * Local dev / static build: single SQLite file at `db/sohamhamso.db`.
 */

// `bun:sqlite` ships with Bun. The import is resolved by Bun's runtime;
// TypeScript may not have built-in types — declare-module fallback below.
// biome-ignore lint/correctness/noUndeclaredDependencies: bun built-in
import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface Text {
  id: string;
  slug: string;
  title_sa: string;
  title_en: string;
  title_iast: string | null;
  author: string | null;
  tradition: string;
  school: string | null;
  era: string | null;
  source: string | null;
  source_url: string | null;
  source_revision: string | null;
  license: string;
  attribution_html: string | null;
  parent_text_id: string | null;
  manuscript_url: string | null;
  description: string | null;
}

export interface TextSummary {
  id: string;
  slug: string;
  title_sa: string;
  title_en: string;
  title_iast: string | null;
  tradition: string;
  school: string | null;
  verse_count: number;
}

export interface Verse {
  id: number;
  text_id: string;
  book: number | null;
  chapter: number;
  verse_num: number;
  devanagari: string;
  slp1: string | null;
  iast: string | null;
  meter: string | null;
  manuscript_folio_ref: string | null;
}

export interface VerseSummary {
  chapter: number;
  verse_num: number;
  devanagari: string;
  iast: string | null;
}

export interface Translation {
  id: number;
  verse_id: number;
  lang: string;
  translator: string | null;
  translation_text: string;
  source: string | null;
  license: string;
  status: 'draft' | 'reviewed' | 'published';
  ai_assisted: boolean;
  model: string | null;
  model_version: string | null;
  prompt_version: string | null;
  judge_score: number | null;
  reviewer: string | null;
  reviewed_at: string | null;
}

export interface WordGloss {
  id: number;
  verse_id: number;
  word_idx: number;
  word_sa: string;
  lemma_sa: string | null;
  lemma_iast: string | null;
  gloss_lang: string;
  gloss_text: string;
  morph: string | null;
}

export interface Parallel {
  id: number;
  source_verse_id: number;
  target_verse_id: number;
  citation_type: string | null;
  confidence: number | null;
  extracted_by: string | null;
  // joined target context for previews
  target_text_slug?: string;
  target_text_title?: string;
  target_chapter?: number;
  target_verse_num?: number;
  target_devanagari?: string;
  target_iast?: string | null;
}

export interface VersePageData {
  text: Text;
  verse: Verse;
  translations: Translation[];
  wordGlosses: WordGloss[];
  parallels: Parallel[];
  prev: { chapter: number; verse_num: number } | null;
  next: { chapter: number; verse_num: number } | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Connection
// ─────────────────────────────────────────────────────────────────────────────

let _db: Database | null = null;

/**
 * Resolve the SQLite file path. Defaults to `<repo>/db/sohamhamso.db`.
 * Priority order:
 *   1. SOHAMHAMSO_DB_PATH env var (explicit override)
 *   2. <cwd>/db/sohamhamso.db (works during `astro build` — cwd is the project root)
 *   3. <source-relative>/../../db/sohamhamso.db (works during `astro dev` and tests)
 * The cwd fallback exists because `astro build` bundles this module under
 * `dist/_worker.js/chunks/...`, so `import.meta.url` resolves to the wrong
 * place during getStaticPaths execution.
 */
function dbPath(): string {
  if (process.env.SOHAMHAMSO_DB_PATH) return process.env.SOHAMHAMSO_DB_PATH;
  const cwdPath = resolve(process.cwd(), 'db', 'sohamhamso.db');
  if (existsSync(cwdPath)) return cwdPath;
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', 'db', 'sohamhamso.db');
}

/**
 * Returns the shared Database instance. Opens read-only (`readonly: true`)
 * because every reader-path query in this module is a SELECT.
 *
 * When `path` is provided, opens a fresh non-cached connection at that
 * path (intended for tests with `:memory:` or temp DBs). The optional
 * `readonly` flag (default `true`) lets tests open a writable handle
 * for seeding fixtures.
 */
export function getDb(path?: string, readonly = true): Database {
  if (path !== undefined) {
    const db = new Database(path, { readonly });
    if (readonly) db.exec('PRAGMA query_only = ON;');
    return db;
  }
  if (_db) return _db;
  _db = new Database(dbPath(), { readonly: true });
  // Slightly faster reads; safe for read-only conn.
  _db.exec('PRAGMA query_only = ON;');
  return _db;
}

/**
 * Inject a Database instance as the module-level singleton (test hook).
 * Pass `null` to clear the cache and force the next `getDb()` to reopen
 * from disk. Production code should never call this.
 */
export function __setDbForTests(db: Database | null): void {
  _db = db;
}

// ─────────────────────────────────────────────────────────────────────────────
// NOTE — writable DB MOVED to `src/lib/subscriber-db.ts`.
//
// The subscribe endpoint ships into a Cloudflare Pages Function bundle where
// `bun:sqlite` (the top-level import in this file) is unavailable. The
// writable path lives in its own module that dynamic-imports `bun:sqlite`
// only in the bun runtime, and uses `@libsql/client/web` at the edge.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List all texts with their verse counts. Used by:
 * - Homepage "All texts (N)" list
 * - Text index pages
 * - `getStaticPaths` enumeration
 */
export function listTexts(): TextSummary[] {
  const db = getDb();
  const stmt = db.query<TextSummary, []>(`
    SELECT
      t.id,
      t.slug,
      t.title_sa,
      t.title_en,
      t.title_iast,
      t.tradition,
      t.school,
      COALESCE((SELECT COUNT(*) FROM verses v WHERE v.text_id = t.id), 0) AS verse_count
    FROM texts t
    ORDER BY t.title_en ASC
  `);
  return stmt.all();
}

/**
 * Get a text record by its slug, or null if missing.
 */
export function getText(slug: string): Text | null {
  const db = getDb();
  const stmt = db.query<Text, [string]>(`SELECT * FROM texts WHERE slug = ? LIMIT 1`);
  return stmt.get(slug) ?? null;
}

/**
 * List all (chapter, verse_num) tuples for a text — used by `getStaticPaths`.
 */
export function listAllVerses(textSlug: string): Array<{ chapter: number; verse_num: number }> {
  const db = getDb();
  const stmt = db.query<{ chapter: number; verse_num: number }, [string]>(`
    SELECT v.chapter, v.verse_num
    FROM verses v
    JOIN texts t ON t.id = v.text_id
    WHERE t.slug = ?
    ORDER BY v.chapter ASC, v.verse_num ASC
  `);
  return stmt.all(textSlug);
}

/**
 * List all chapters in a text along with their verse counts.
 */
export function listChapters(textSlug: string): Array<{ chapter: number; verse_count: number }> {
  const db = getDb();
  const stmt = db.query<{ chapter: number; verse_count: number }, [string]>(`
    SELECT v.chapter, COUNT(*) AS verse_count
    FROM verses v
    JOIN texts t ON t.id = v.text_id
    WHERE t.slug = ?
    GROUP BY v.chapter
    ORDER BY v.chapter ASC
  `);
  return stmt.all(textSlug);
}

/**
 * List verse summaries (no glosses) for a given chapter.
 * Used by the chapter/text overview pages.
 */
export function listChapterVerses(textSlug: string, chapter: number): VerseSummary[] {
  const db = getDb();
  const stmt = db.query<VerseSummary, [string, number]>(`
    SELECT v.chapter, v.verse_num, v.devanagari, v.iast
    FROM verses v
    JOIN texts t ON t.id = v.text_id
    WHERE t.slug = ? AND v.chapter = ?
    ORDER BY v.verse_num ASC
  `);
  return stmt.all(textSlug, chapter);
}

// ─────────────────────────────────────────────────────────────────────────────
// Chapter summary (chapter index pages)
// ─────────────────────────────────────────────────────────────────────────────

export interface ChapterVerseSummary {
  verse_num: number;
  devanagari: string;
  iast: string | null;
  /** First ~8 words of the IAST line (verse-row incipit). */
  iast_incipit: string | null;
  /** Full text of the picked translation row (used by 1-verse chapters). */
  translation_text: string | null;
  /** First clause of the translation, ~90 chars cut at a word boundary. */
  translation_first_clause: string | null;
  /** Language of the picked translation (requested lang, or 'en' fallback). */
  translation_lang: string | null;
}

/** First `maxWords` words of an IAST line, whitespace-collapsed. */
function iastIncipit(iast: string | null, maxWords = 8): string | null {
  if (!iast) return null;
  const words = iast.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length === 0) return null;
  const head = words.slice(0, maxWords).join(' ');
  return words.length > maxWords ? `${head} …` : head;
}

/**
 * First clause of a translation, capped at ~`maxChars` characters and cut
 * at a word boundary. "Clause" = text up to the first sentence-ending or
 * strong-clause punctuation (. ; ! ?) — em-dashes/colons are NOT
 * boundaries (they commonly open parentheticals mid-clause); longer
 * clauses are ellipsized.
 */
function translationFirstClause(text: string | null, maxChars = 90): string | null {
  if (!text) return null;
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (!collapsed) return null;
  const match = collapsed.match(/^[^.;!?]+[.;!?]?/);
  const clause = (match ? match[0] : collapsed).trim();
  if (clause.length <= maxChars) return clause;
  const cut = clause.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 40 ? lastSpace : maxChars).trimEnd()}…`;
}

/**
 * Lightweight per-verse summary for the chapter index pages
 * (`/{tradition}/{text}/{chapter}/`): verse number, IAST incipit and a
 * one-clause translation snippet. Deliberately CHEAP — one query over
 * `verses` with two correlated `translations` sub-selects; never pulls
 * glosses/parallels/reader bundles (do NOT swap in `getVerse` here).
 *
 * Translation row selection uses explicit status priority
 * (published → reviewed → draft, then human-first, then oldest) rather
 * than the alphabetical `ORDER BY status` quirk. For non-EN `lang` the
 * snippet falls back to English per verse when the requested language
 * has no row; `translation_lang` reports which language was used.
 */
export function listChapterSummary(
  textSlug: string,
  chapter: number,
  lang = 'en',
): ChapterVerseSummary[] {
  const db = getDb();
  type Row = {
    verse_num: number;
    devanagari: string;
    iast: string | null;
    requested_translation: string | null;
    english_translation: string | null;
  };
  const rows = db
    .query<Row, [string, string, number]>(`
      SELECT
        v.verse_num,
        v.devanagari,
        v.iast,
        (
          SELECT tr.translation_text
          FROM translations tr
          WHERE tr.verse_id = v.id
            AND tr.lang = ?
            AND tr.status IN ('published', 'reviewed', 'draft')
          ORDER BY
            CASE tr.status WHEN 'published' THEN 0 WHEN 'reviewed' THEN 1 ELSE 2 END,
            tr.ai_assisted ASC,
            tr.created_at ASC
          LIMIT 1
        ) AS requested_translation,
        (
          SELECT tr.translation_text
          FROM translations tr
          WHERE tr.verse_id = v.id
            AND tr.lang = 'en'
            AND tr.status IN ('published', 'reviewed', 'draft')
          ORDER BY
            CASE tr.status WHEN 'published' THEN 0 WHEN 'reviewed' THEN 1 ELSE 2 END,
            tr.ai_assisted ASC,
            tr.created_at ASC
          LIMIT 1
        ) AS english_translation
      FROM verses v
      JOIN texts t ON t.id = v.text_id
      WHERE t.slug = ? AND v.chapter = ?
      ORDER BY v.verse_num ASC
    `)
    .all(lang, textSlug, chapter);

  return rows.map((row: Row) => {
    const translation = row.requested_translation ?? row.english_translation;
    const translationLang =
      row.requested_translation !== null ? lang : row.english_translation !== null ? 'en' : null;
    return {
      verse_num: row.verse_num,
      devanagari: row.devanagari,
      iast: row.iast,
      iast_incipit: iastIncipit(row.iast),
      translation_text: translation,
      translation_first_clause: translationFirstClause(translation),
      translation_lang: translationLang,
    };
  });
}

/**
 * Fetch a single verse with everything the reader page needs:
 * verse row, translations (filtered to `lang`), word_glosses (filtered to
 * `lang`), parallel-passage targets (joined with target verse summary),
 * and prev/next navigation cursors within the same text.
 *
 * Returns null if the verse doesn't exist.
 */
export function getVerse(
  textSlug: string,
  chapter: number,
  verseNum: number,
  lang = 'en',
): VersePageData | null {
  const db = getDb();

  const text = getText(textSlug);
  if (!text) return null;

  const verse = db
    .query<Verse, [string, number, number]>(`
      SELECT v.*
      FROM verses v
      WHERE v.text_id = ? AND v.chapter = ? AND v.verse_num = ?
      LIMIT 1
    `)
    .get(text.id, chapter, verseNum);
  if (!verse) return null;

  // Translations for the requested language. V1 ships AI-only with the
  // amber "not verified" badge for draft AND published; agents flag
  // per-verse uncertainty inline with [draft] prefix and the merge
  // pipeline promotes those to status='draft'. Both render with the
  // amber badge. ai_assisted comes back as 0/1 int; normalized below.
  type TransRow = Omit<Translation, 'ai_assisted'> & { ai_assisted: number };
  const rawTranslations = db
    .query<TransRow, [number, string]>(`
      SELECT *
      FROM translations
      WHERE verse_id = ? AND lang = ? AND status IN ('published', 'reviewed', 'draft')
      ORDER BY ai_assisted ASC, status ASC, created_at ASC
    `)
    .all(verse.id, lang);
  const translations: Translation[] = rawTranslations.map((t: TransRow) => ({
    ...t,
    ai_assisted: t.ai_assisted === 1,
  }));

  const wordGlosses = db
    .query<WordGloss, [number, string]>(`
      SELECT *
      FROM word_glosses
      WHERE verse_id = ? AND gloss_lang = ?
      ORDER BY word_idx ASC
    `)
    .all(verse.id, lang);

  // Parallels: join target verse summary so the chip/sheet can render
  // mini-anatomy without a second round trip per item.
  const parallels = db
    .query<Parallel, [number]>(`
      SELECT
        p.id,
        p.source_verse_id,
        p.target_verse_id,
        p.citation_type,
        p.confidence,
        p.extracted_by,
        tt.slug AS target_text_slug,
        tt.title_en AS target_text_title,
        tv.chapter AS target_chapter,
        tv.verse_num AS target_verse_num,
        tv.devanagari AS target_devanagari,
        tv.iast AS target_iast
      FROM parallels p
      JOIN verses tv ON tv.id = p.target_verse_id
      JOIN texts tt ON tt.id = tv.text_id
      WHERE p.source_verse_id = ?
      ORDER BY p.confidence DESC NULLS LAST
    `)
    .all(verse.id);

  // Prev/next within the same text (lex order on chapter, verse_num).
  const prev =
    db
      .query<{ chapter: number; verse_num: number }, [string, number, number, number]>(`
      SELECT v.chapter, v.verse_num
      FROM verses v
      WHERE v.text_id = ?
        AND (v.chapter < ? OR (v.chapter = ? AND v.verse_num < ?))
      ORDER BY v.chapter DESC, v.verse_num DESC
      LIMIT 1
    `)
      .get(text.id, chapter, chapter, verseNum) ?? null;

  const next =
    db
      .query<{ chapter: number; verse_num: number }, [string, number, number, number]>(`
      SELECT v.chapter, v.verse_num
      FROM verses v
      WHERE v.text_id = ?
        AND (v.chapter > ? OR (v.chapter = ? AND v.verse_num > ?))
      ORDER BY v.chapter ASC, v.verse_num ASC
      LIMIT 1
    `)
      .get(text.id, chapter, chapter, verseNum) ?? null;

  return {
    text,
    verse,
    translations,
    wordGlosses,
    parallels,
    prev,
    next,
  };
}

/**
 * Return per-language glosses + per-language translations for a single
 * verse. Used by the reader-language client island (`ReaderLangSwap`) to
 * pre-bundle every supported reader language into the static HTML, so the
 * swap to Hindi / Tamil / etc. is near-instant with no extra round trip.
 *
 * Returned shape:
 *   {
 *     glosses_by_lang: { en: [...], hi: [...], ... }
 *     translations_by_lang: { en: { translation_text, translator, ... }, ... }
 *   }
 *
 * `glosses_by_lang[lang]` is the array of {word_idx, word_sa, lemma_iast,
 * gloss_text, morph} ordered by word_idx ASC. For translations we keep
 * the FIRST published/reviewed row per language (the same row
 * VerseAnatomy renders as primary).
 *
 * Single query each — pulls all langs together (no `WHERE gloss_lang = ?`).
 */
export function getVerseAllLanguages(
  textSlug: string,
  chapter: number,
  verseNum: number,
): {
  verse: Verse;
  glosses_by_lang: Record<
    string,
    Array<{
      word_idx: number;
      word_sa: string;
      lemma_iast: string | null;
      gloss_text: string;
      morph: string | null;
    }>
  >;
  translations_by_lang: Record<
    string,
    {
      lang: string;
      translation_text: string;
      translator: string | null;
      ai_assisted: boolean;
    }
  >;
} | null {
  const db = getDb();
  const text = getText(textSlug);
  if (!text) return null;

  const verse = db
    .query<Verse, [string, number, number]>(`
      SELECT v.*
      FROM verses v
      WHERE v.text_id = ? AND v.chapter = ? AND v.verse_num = ?
      LIMIT 1
    `)
    .get(text.id, chapter, verseNum);
  if (!verse) return null;

  const glossRows = db
    .query<
      {
        word_idx: number;
        word_sa: string;
        lemma_iast: string | null;
        gloss_lang: string;
        gloss_text: string;
        morph: string | null;
      },
      [number]
    >(`
      SELECT word_idx, word_sa, lemma_iast, gloss_lang, gloss_text, morph
      FROM word_glosses
      WHERE verse_id = ?
      ORDER BY gloss_lang ASC, word_idx ASC
    `)
    .all(verse.id);

  const glosses_by_lang: Record<
    string,
    Array<{
      word_idx: number;
      word_sa: string;
      lemma_iast: string | null;
      gloss_text: string;
      morph: string | null;
    }>
  > = {};
  for (const g of glossRows) {
    const list = glosses_by_lang[g.gloss_lang] ?? (glosses_by_lang[g.gloss_lang] = []);
    list.push({
      word_idx: g.word_idx,
      word_sa: g.word_sa,
      lemma_iast: g.lemma_iast,
      gloss_text: g.gloss_text,
      morph: g.morph,
    });
  }

  // Mirror getVerse() ordering: ai_assisted ASC, created_at ASC — the
  // first row per lang is the "primary" one VerseAnatomy renders.
  const trRows = db
    .query<
      { lang: string; translation_text: string; translator: string | null; ai_assisted: number },
      [number]
    >(`
      SELECT lang, translation_text, translator, ai_assisted, status
      FROM translations
      WHERE verse_id = ? AND status IN ('published', 'reviewed', 'draft')
      ORDER BY lang ASC, ai_assisted ASC, status ASC, created_at ASC
    `)
    .all(verse.id);

  const translations_by_lang: Record<
    string,
    { lang: string; translation_text: string; translator: string | null; ai_assisted: boolean }
  > = {};
  for (const t of trRows) {
    if (translations_by_lang[t.lang]) continue; // keep the first per lang
    translations_by_lang[t.lang] = {
      lang: t.lang,
      translation_text: t.translation_text,
      translator: t.translator,
      ai_assisted: t.ai_assisted === 1,
    };
  }

  return { verse, glosses_by_lang, translations_by_lang };
}

/**
 * Return the set of language codes that have at least one published or
 * reviewed translation anywhere in the corpus. Used by the global
 * language picker (Masthead) and subscribe band to decide which langs
 * render as "available" vs "soon".
 *
 * Returns lowercase ISO codes (`en`, `hi`, `ta`, ...) — callers using
 * uppercase display codes should normalize with `.toLowerCase()` before
 * membership testing.
 *
 * Cheap; runs at build time during Astro SSG and against the shared
 * read-only singleton, so repeated calls across pages don't re-open
 * the SQLite file.
 */
export function getAvailableLanguages(): Set<string> {
  const db = getDb();
  const rows = db
    .query<{ lang: string }, []>(`
      SELECT DISTINCT lang
      FROM translations
      WHERE status IN ('published', 'reviewed', 'draft')
    `)
    .all();
  return new Set(rows.map((r: { lang: string }) => r.lang.toLowerCase()));
}

/**
 * Return ALL translations for a verse across every language. Powers the
 * TranslationDrawer's multi-select chip availability + stacked preview.
 *
 * Same status filter as getVerse — drafts surface alongside published/reviewed
 * in V1's AI-only posture (per-verse [draft] uncertainty is communicated
 * through the amber AIAssistedBadge variant). ai_assisted is normalized to bool.
 */
export function getVerseTranslations(verseId: number): Translation[] {
  type TransRow = Omit<Translation, 'ai_assisted'> & { ai_assisted: number };
  const db = getDb();
  const rows = db
    .query<TransRow, [number]>(`
      SELECT *
      FROM translations
      WHERE verse_id = ? AND status IN ('published', 'reviewed', 'draft')
      ORDER BY lang ASC, ai_assisted ASC, status ASC, created_at ASC
    `)
    .all(verseId);
  return rows.map((t: TransRow) => ({ ...t, ai_assisted: t.ai_assisted === 1 }));
}
