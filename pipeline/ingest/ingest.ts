#!/usr/bin/env bun
/**
 * sohamhamso — YAML corpus ingestion
 *
 * Reads `data/corpus/*.yaml` and upserts rows into the local SQLite DB
 * at `db/sohamhamso.db`. Idempotent: re-running does not duplicate, and
 * unchanged content is a true no-op (updated_at is only touched when row
 * content actually changes). Reconciling: verses/translations/word_glosses
 * present in the DB but absent from the incoming YAML are deleted, so
 * removed or renumbered verses do not stay public forever (routes generate
 * from the DB, not from YAML).
 *
 * Run:
 *   bun pipeline/ingest/ingest.ts
 *   bun pipeline/ingest/ingest.ts --db custom.db --dir data/corpus
 *
 * Schema: db/schema.sql
 *
 * YAML shape (per file = one text):
 *   id: spandakarika
 *   slug: spandakarika
 *   title_sa: स्पन्दकारिका
 *   title_en: Spanda Karika
 *   ...
 *   chapters:
 *     - chapter: 1
 *       title_sa: सृष्टिप्रकरणम्        # optional chapter titles -> `chapters`
 *       title_iast: sṛṣṭi-prakaraṇam   # optional
 *       title_en: Creation of the world  # optional
 *       verses:
 *         - verse_num: 1
 *           devanagari: "..."
 *           slp1: "..."
 *           iast: "..."
 *           meter: anushtubh
 *           book: 1                       # optional
 *           manuscript_folio_ref: "..."  # optional
 *           section_type: prose          # optional ('verse' default | 'prose')
 *           prose_block_ref: "uddyota-1.1"  # optional, prose blocks only
 *           word_glosses:
 *             - word_idx: 0
 *               word_sa: "यस्य"
 *               lemma_sa: "यद्"
 *               lemma_iast: "yad"
 *               gloss_lang: en
 *               gloss_text: "of whom"
 *               morph: "REL.GEN.SG"
 *           translations:
 *             - lang: en
 *               translator: "Jaideva Singh"
 *               translation_text: "..."
 *               source: "Spanda-Kārikās, 1980"
 *               license: "CC-BY-4.0"
 *               status: "published"
 *               ai_assisted: false
 *               model: null
 *               model_version: null
 *               prompt_version: null
 *               judge_score: null
 *               reviewer: "vidya-acharya"
 *               reviewed_at: "2026-01-15T00:00:00Z"
 */

import { Database } from 'bun:sqlite';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Sanscript from '@indic-transliteration/sanscript';
import { load as yamlLoad } from 'js-yaml';
import { parseCorpusDocument, parseCorpusFaqDocument } from '../../src/lib/seo/corpus-schema';

// ---------------------------------------------------------------
// Script normalisation
// ---------------------------------------------------------------

/**
 * Returns true when `s` contains at least one Devanāgarī code point
 * (U+0900–U+097F). Used to decide whether a YAML `word`/`word_sa` value
 * is already in the canonical script or needs to be transliterated from
 * IAST/Latin. We deliberately accept "any Devanāgarī" rather than "no
 * Latin" so that mixed strings (rare, but present in some compounds with
 * editor brackets) take the no-op path.
 */
export function isDevanagari(s: string | null | undefined): boolean {
  if (!s) return false;
  return /[ऀ-ॿ]/.test(s);
}

/**
 * Best-effort normalisation: if the input is already Devanāgarī, return
 * it untouched. Otherwise treat it as IAST and run it through Sanscript.
 * The downstream ScriptSwitcher uses `data-sa-source` containing
 * Devanāgarī as its canonical form, so storing anything else here would
 * cause the on-page transliteration to produce garbage when the reader
 * selects Tamil, Bengali, etc.
 */
export function toDevanagari(s: string | null | undefined): string {
  if (!s) return '';
  if (isDevanagari(s)) return s;
  try {
    return Sanscript.t(s, 'iast', 'devanagari');
  } catch {
    return s;
  }
}

// ---------------------------------------------------------------
// Paths
// ---------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// pipeline/ingest/ingest.ts -> project root is two levels up
export const PROJECT_ROOT = resolve(__dirname, '..', '..');
export const DEFAULT_DB_PATH = join(PROJECT_ROOT, 'db', 'sohamhamso.db');
export const DEFAULT_CORPUS_DIR = join(PROJECT_ROOT, 'data', 'corpus');

// ---------------------------------------------------------------
// Types
// ---------------------------------------------------------------

export interface WordGlossYaml {
  word_idx: number;
  word_sa: string;
  lemma_sa?: string | null;
  lemma_iast?: string | null;
  gloss_lang: string;
  gloss_text: string;
  morph?: string | null;
}

export interface TranslationYaml {
  lang: string;
  translator?: string | null;
  translation_text: string;
  source?: string | null;
  license: string;
  status: 'draft' | 'reviewed' | 'published';
  ai_assisted?: boolean | number | null;
  model?: string | null;
  model_version?: string | null;
  prompt_version?: string | null;
  judge_score?: number | null;
  reviewer?: string | null;
  reviewed_at?: string | null;
}

export interface VerseYaml {
  verse_num: number;
  book?: number | null;
  devanagari: string;
  slp1?: string | null;
  iast?: string | null;
  meter?: string | null;
  manuscript_folio_ref?: string | null;
  /** Prose blocks share verse numbering (verse_num >= 1; 0 is reserved). */
  section_type?: 'verse' | 'prose' | null;
  prose_block_ref?: string | null;
  word_glosses?: WordGlossYaml[];
  translations?: TranslationYaml[];
}

export interface ChapterYaml {
  chapter: number;
  /** Optional wayfinding titles — persisted to `chapters` when present. */
  title_sa?: string | null;
  title_iast?: string | null;
  title_en?: string | null;
  verses: VerseYaml[];
}

export interface TextYaml {
  id: string;
  slug: string;
  title_sa: string;
  title_en: string;
  title_iast?: string | null;
  author?: string | null;
  tradition: string;
  school?: string | null;
  era?: string | null;
  source?: string | null;
  source_url?: string | null;
  source_revision?: string | null;
  license: string;
  attribution_html?: string | null;
  parent_text_id?: string | null;
  manuscript_url?: string | null;
  description?: string | null;
  /** Editorial flag only — no DB column; carried through for tooling. */
  pending_miri?: boolean | null;
  /** When declared, ingest aborts if the actual verse count differs. */
  expected_verse_count?: number | null;
  chapters: ChapterYaml[];
}

function isCorpusSourceFile(name: string): boolean {
  return (
    (name.endsWith('.yaml') || name.endsWith('.yml')) &&
    !/\.faq\.ya?ml$/i.test(name) &&
    !name.startsWith('_')
  );
}

export interface FileStats {
  file: string;
  text_id: string;
  verses: number;
  glosses: number;
  translations: number;
}

export interface RunSummary {
  files: FileStats[];
  total_verses: number;
  total_texts: number;
  total_glosses: number;
  total_translations: number;
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

/**
 * Canonical translator label for rows whose YAML omits `translator`.
 * NULLs are pairwise distinct under SQLite UNIQUE constraints, so a NULL
 * translator in the `(verse_id, lang, translator)` key would make every
 * re-ingest insert a fresh duplicate row instead of hitting the upsert.
 */
export const DEFAULT_TRANSLATOR = 'unattributed';

function boolToInt(v: boolean | number | null | undefined): number {
  if (v === true || v === 1) return 1;
  return 0;
}

function nz<T>(v: T | undefined | null): T | null {
  return v === undefined ? null : v;
}

/**
 * Parse a single YAML file into a TextYaml object. Throws on invalid shape.
 */
export function parseTextYaml(filePath: string): TextYaml {
  const raw = readFileSync(filePath, 'utf8');
  const loaded = yamlLoad(raw);
  if (!loaded || typeof loaded !== 'object') {
    throw new Error(`${filePath}: YAML root is not an object`);
  }
  const document = parseCorpusDocument(loaded);
  if (document.faq_file) {
    const faqPath = resolve(dirname(filePath), document.faq_file);
    if (!existsSync(faqPath)) {
      throw new Error(`${filePath}: faq_file not found: ${document.faq_file}`);
    }
    const faqRaw = yamlLoad(readFileSync(faqPath, 'utf8'));
    parseCorpusFaqDocument(faqRaw);
  }

  // Normalise per-verse field aliases so downstream code can stay strict.
  const chaptersRaw = document.chapters as Array<Record<string, unknown>>;
  const chapters = chaptersRaw.map((ch) => {
    const versesRaw = Array.isArray(ch.verses) ? (ch.verses as Record<string, unknown>[]) : [];
    const verses = versesRaw.map((v) => {
      const verse_num =
        typeof v.verse_num === 'number'
          ? v.verse_num
          : typeof v.verse === 'number'
            ? v.verse
            : v.verse_num;
      const glossesRaw = Array.isArray(v.word_glosses)
        ? (v.word_glosses as Record<string, unknown>[])
        : [];
      const word_glosses = glossesRaw.flatMap((g, i) => {
        // Some YAML files (e.g. Śiva Sūtras) store the surface form in
        // IAST instead of Devanāgarī. The ScriptSwitcher island treats
        // word_sa as the canonical Devanāgarī source for on-page
        // transliteration, so we normalise here. If `word_sa` is already
        // Devanāgarī we keep it untouched; if it's IAST we round-trip
        // through Sanscript and also preserve the original IAST in
        // `lemma_iast` (unless the YAML already provided one).
        const rawWord = (g.word_sa ?? g.word) as string;
        const word_sa = toDevanagari(rawWord);
        const explicitIast = (g.lemma_iast ?? g.iast ?? null) as string | null;
        const lemma_iast = explicitIast ?? (rawWord && !isDevanagari(rawWord) ? rawWord : null);
        const word_idx = typeof g.word_idx === 'number' ? g.word_idx : i;
        const lemma_sa = (g.lemma_sa ?? null) as string | null;
        const morph = (g.morph ?? null) as string | null;

        // English gloss — backward-compatible via gloss_text / gloss_en / gloss.
        // If gloss_lang is explicitly set, honour it instead of defaulting to en.
        const englishText = (g.gloss_text ?? g.gloss_en ?? g.gloss ?? '') as string;
        const englishLang = (g.gloss_lang ?? 'en') as string;

        const out: Array<{
          word_idx: number;
          word_sa: string;
          lemma_sa: string | null;
          lemma_iast: string | null;
          gloss_lang: string;
          gloss_text: string;
          morph: string | null;
        }> = [];
        if (englishText) {
          out.push({
            word_idx,
            word_sa,
            lemma_sa,
            lemma_iast,
            gloss_lang: englishLang,
            gloss_text: englishText,
            morph,
          });
        }

        // Multi-language extension: pick up any `gloss_{lang}` field with a
        // 2-letter ISO code (excluding the legacy gloss_en handled above)
        // and emit an additional row.
        for (const [key, val] of Object.entries(g)) {
          const m = /^gloss_([a-z]{2})$/.exec(key);
          if (!m) continue;
          const lang = m[1];
          if (lang === 'en') continue; // already handled
          if (typeof val !== 'string' || !val.trim()) continue;
          out.push({
            word_idx,
            word_sa,
            lemma_sa,
            lemma_iast,
            gloss_lang: lang,
            gloss_text: val,
            morph,
          });
        }

        return out;
      });
      const translationsRaw = Array.isArray(v.translations)
        ? (v.translations as Record<string, unknown>[])
        : [];
      const translations = translationsRaw.map((t) => ({
        lang: (t.lang ?? 'en') as string,
        translator: (t.translator ?? null) as string | null,
        translation_text: (t.translation_text ?? t.text ?? '') as string,
        source: (t.source ?? null) as string | null,
        license: (t.license ?? 'PD') as string,
        status: (t.status ?? 'published') as 'draft' | 'reviewed' | 'published',
        ai_assisted: (t.ai_assisted ?? false) as boolean | number | null,
        model: (t.model ?? null) as string | null,
        model_version: (t.model_version ?? null) as string | null,
        prompt_version: (t.prompt_version ?? null) as string | null,
        judge_score: (t.judge_score ?? null) as number | null,
        reviewer: (t.reviewer ?? null) as string | null,
        reviewed_at: (t.reviewed_at ?? null) as string | null,
      }));
      return { ...v, verse_num, word_glosses, translations } as unknown as VerseYaml;
    });
    return { ...ch, verses } as unknown as ChapterYaml;
  });
  const doc = { ...document.text, chapters } as unknown as TextYaml;
  if (!doc.id) throw new Error(`${filePath}: missing required field 'id'`);
  if (!doc.slug) throw new Error(`${filePath}: missing required field 'slug'`);
  if (!doc.title_sa) throw new Error(`${filePath}: missing required field 'title_sa'`);
  if (!doc.title_en) throw new Error(`${filePath}: missing required field 'title_en'`);
  if (!doc.tradition) throw new Error(`${filePath}: missing required field 'tradition'`);
  if (!doc.license) throw new Error(`${filePath}: missing required field 'license'`);
  if (!Array.isArray(doc.chapters)) {
    throw new Error(`${filePath}: 'chapters' must be an array`);
  }
  return doc;
}

// ---------------------------------------------------------------
// SQL upserts
// ---------------------------------------------------------------

export function prepareStatements(db: Database) {
  // The DO UPDATE clauses on texts/translations carry a WHERE guard
  // (NULL-safe `IS NOT` per column) so re-ingesting unchanged content is a
  // genuine no-op: updated_at is preserved and the DB stays diff-stable.
  const upsertText = db.prepare(`
    INSERT INTO texts (
      id, slug, title_sa, title_en, title_iast, author, tradition, school,
      era, source, source_url, source_revision, license, attribution_html,
      parent_text_id, manuscript_url, description, updated_at
    ) VALUES (
      $id, $slug, $title_sa, $title_en, $title_iast, $author, $tradition, $school,
      $era, $source, $source_url, $source_revision, $license, $attribution_html,
      $parent_text_id, $manuscript_url, $description, datetime('now')
    )
    ON CONFLICT(id) DO UPDATE SET
      slug = excluded.slug,
      title_sa = excluded.title_sa,
      title_en = excluded.title_en,
      title_iast = excluded.title_iast,
      author = excluded.author,
      tradition = excluded.tradition,
      school = excluded.school,
      era = excluded.era,
      source = excluded.source,
      source_url = excluded.source_url,
      source_revision = excluded.source_revision,
      license = excluded.license,
      attribution_html = excluded.attribution_html,
      parent_text_id = excluded.parent_text_id,
      manuscript_url = excluded.manuscript_url,
      description = excluded.description,
      updated_at = datetime('now')
    WHERE
      texts.slug IS NOT excluded.slug
      OR texts.title_sa IS NOT excluded.title_sa
      OR texts.title_en IS NOT excluded.title_en
      OR texts.title_iast IS NOT excluded.title_iast
      OR texts.author IS NOT excluded.author
      OR texts.tradition IS NOT excluded.tradition
      OR texts.school IS NOT excluded.school
      OR texts.era IS NOT excluded.era
      OR texts.source IS NOT excluded.source
      OR texts.source_url IS NOT excluded.source_url
      OR texts.source_revision IS NOT excluded.source_revision
      OR texts.license IS NOT excluded.license
      OR texts.attribution_html IS NOT excluded.attribution_html
      OR texts.parent_text_id IS NOT excluded.parent_text_id
      OR texts.manuscript_url IS NOT excluded.manuscript_url
      OR texts.description IS NOT excluded.description
  `);

  const upsertVerse = db.prepare(`
    INSERT INTO verses (
      text_id, book, chapter, verse_num, devanagari, slp1, iast, meter,
      manuscript_folio_ref, section_type, prose_block_ref
    ) VALUES (
      $text_id, $book, $chapter, $verse_num, $devanagari, $slp1, $iast, $meter,
      $manuscript_folio_ref, $section_type, $prose_block_ref
    )
    ON CONFLICT(text_id, chapter, verse_num) DO UPDATE SET
      book = excluded.book,
      devanagari = excluded.devanagari,
      slp1 = excluded.slp1,
      iast = excluded.iast,
      meter = excluded.meter,
      manuscript_folio_ref = excluded.manuscript_folio_ref,
      section_type = excluded.section_type,
      prose_block_ref = excluded.prose_block_ref
    RETURNING id
  `);

  const selectVerseId = db.prepare(`
    SELECT id FROM verses WHERE text_id = $text_id AND chapter = $chapter AND verse_num = $verse_num
  `);

  // Chapter titles are content-conditional: rows exist only for chapters
  // whose YAML declares at least one of title_sa/title_iast/title_en. The
  // WHERE guard keeps unchanged re-ingests a true no-op (updated_at stays).
  const upsertChapterTitle = db.prepare(`
    INSERT INTO chapters (text_id, chapter, title_sa, title_iast, title_en, updated_at)
    VALUES ($text_id, $chapter, $title_sa, $title_iast, $title_en, datetime('now'))
    ON CONFLICT(text_id, chapter) DO UPDATE SET
      title_sa = excluded.title_sa,
      title_iast = excluded.title_iast,
      title_en = excluded.title_en,
      updated_at = datetime('now')
    WHERE
      chapters.title_sa IS NOT excluded.title_sa
      OR chapters.title_iast IS NOT excluded.title_iast
      OR chapters.title_en IS NOT excluded.title_en
  `);

  const upsertGloss = db.prepare(`
    INSERT INTO word_glosses (
      verse_id, word_idx, word_sa, lemma_sa, lemma_iast, gloss_lang, gloss_text, morph
    ) VALUES (
      $verse_id, $word_idx, $word_sa, $lemma_sa, $lemma_iast, $gloss_lang, $gloss_text, $morph
    )
    ON CONFLICT(verse_id, word_idx, gloss_lang) DO UPDATE SET
      word_sa = excluded.word_sa,
      lemma_sa = excluded.lemma_sa,
      lemma_iast = excluded.lemma_iast,
      gloss_text = excluded.gloss_text,
      morph = excluded.morph
  `);

  const upsertTranslation = db.prepare(`
    INSERT INTO translations (
      verse_id, lang, translator, translation_text, source, license, status,
      ai_assisted, model, model_version, prompt_version, judge_score,
      reviewer, reviewed_at, updated_at
    ) VALUES (
      $verse_id, $lang, $translator, $translation_text, $source, $license, $status,
      $ai_assisted, $model, $model_version, $prompt_version, $judge_score,
      $reviewer, $reviewed_at, datetime('now')
    )
    ON CONFLICT(verse_id, lang, translator) DO UPDATE SET
      translation_text = excluded.translation_text,
      source = excluded.source,
      license = excluded.license,
      status = excluded.status,
      ai_assisted = excluded.ai_assisted,
      model = excluded.model,
      model_version = excluded.model_version,
      prompt_version = excluded.prompt_version,
      judge_score = excluded.judge_score,
      reviewer = excluded.reviewer,
      reviewed_at = excluded.reviewed_at,
      updated_at = datetime('now')
    WHERE
      translations.translation_text IS NOT excluded.translation_text
      OR translations.source IS NOT excluded.source
      OR translations.license IS NOT excluded.license
      OR translations.status IS NOT excluded.status
      OR translations.ai_assisted IS NOT excluded.ai_assisted
      OR translations.model IS NOT excluded.model
      OR translations.model_version IS NOT excluded.model_version
      OR translations.prompt_version IS NOT excluded.prompt_version
      OR translations.judge_score IS NOT excluded.judge_score
      OR translations.reviewer IS NOT excluded.reviewer
      OR translations.reviewed_at IS NOT excluded.reviewed_at
  `);

  // Reconciliation: rows present in the DB but absent from the incoming
  // YAML are deleted inside the same per-text transaction. Delete order
  // respects the FK graph: word_glosses/translations/parallels reference
  // verses(id), so children go first. NOTE: videos.translation_row_id also
  // references translations(id) (including chapter-format rows, which live
  // in `videos` with verse_num=0 — never in `verses`); deleting a
  // translation a video still pins will FK-fail and roll the file back,
  // which is intentional: video provenance must not be silently orphaned.
  const selectVerseIdsForText = db.prepare(`
    SELECT id FROM verses WHERE text_id = $text_id
  `);
  const selectGlossKeysForVerse = db.prepare(`
    SELECT id, word_idx, gloss_lang FROM word_glosses WHERE verse_id = $verse_id
  `);
  const selectTranslationKeysForVerse = db.prepare(`
    SELECT id, lang, translator FROM translations WHERE verse_id = $verse_id
  `);
  const deleteGlossById = db.prepare('DELETE FROM word_glosses WHERE id = $id');
  const deleteTranslationById = db.prepare('DELETE FROM translations WHERE id = $id');
  const deleteGlossesByVerse = db.prepare('DELETE FROM word_glosses WHERE verse_id = $verse_id');
  const deleteTranslationsByVerse = db.prepare(
    'DELETE FROM translations WHERE verse_id = $verse_id',
  );
  const deleteParallelsByVerse = db.prepare(`
    DELETE FROM parallels WHERE source_verse_id = $verse_id OR target_verse_id = $verse_id
  `);
  const deleteVerseById = db.prepare('DELETE FROM verses WHERE id = $id');
  const selectChapterTitleNumsForText = db.prepare(`
    SELECT chapter FROM chapters WHERE text_id = $text_id
  `);
  const deleteChapterTitle = db.prepare(`
    DELETE FROM chapters WHERE text_id = $text_id AND chapter = $chapter
  `);

  return {
    upsertText,
    upsertVerse,
    selectVerseId,
    upsertChapterTitle,
    upsertGloss,
    upsertTranslation,
    selectVerseIdsForText,
    selectGlossKeysForVerse,
    selectTranslationKeysForVerse,
    deleteGlossById,
    deleteTranslationById,
    deleteGlossesByVerse,
    deleteTranslationsByVerse,
    deleteParallelsByVerse,
    deleteVerseById,
    selectChapterTitleNumsForText,
    deleteChapterTitle,
  };
}

// ---------------------------------------------------------------
// Per-file ingestion (inside a transaction)
// ---------------------------------------------------------------

export function ingestText(
  db: Database,
  stmts: ReturnType<typeof prepareStatements>,
  doc: TextYaml,
  file: string,
): FileStats {
  let verseCount = 0;
  let glossCount = 0;
  let translationCount = 0;

  // Reconciliation bookkeeping: every verse/gloss/translation seen in the
  // YAML is recorded here; anything else under this text is deleted at the
  // end of the transaction.
  const keptVerseIds = new Set<number>();
  const keptGlossKeys = new Map<number, Set<string>>(); // verse_id -> "word_idx\x1Fgloss_lang"
  const keptTranslationKeys = new Map<number, Set<string>>(); // verse_id -> "lang\x1Ftranslator"
  const keptChapterTitleNums = new Set<number>(); // chapters with a titles row in this YAML

  const runTx = db.transaction(() => {
    stmts.upsertText.run({
      $id: doc.id,
      $slug: doc.slug,
      $title_sa: doc.title_sa,
      $title_en: doc.title_en,
      $title_iast: nz(doc.title_iast),
      $author: nz(doc.author),
      $tradition: doc.tradition,
      $school: nz(doc.school),
      $era: nz(doc.era),
      $source: nz(doc.source),
      $source_url: nz(doc.source_url),
      $source_revision: nz(doc.source_revision),
      $license: doc.license,
      $attribution_html: nz(doc.attribution_html),
      $parent_text_id: nz(doc.parent_text_id),
      $manuscript_url: nz(doc.manuscript_url),
      $description: nz(doc.description),
    });

    for (const chapter of doc.chapters) {
      if (typeof chapter.chapter !== 'number') {
        throw new Error(`${file}: chapter missing numeric 'chapter' field`);
      }
      if (!Array.isArray(chapter.verses)) continue;

      // Content-conditional chapter-titles row: only when the YAML declares
      // at least one title. Untitled chapters keep no row (reconciled below).
      if (chapter.title_sa || chapter.title_iast || chapter.title_en) {
        stmts.upsertChapterTitle.run({
          $text_id: doc.id,
          $chapter: chapter.chapter,
          $title_sa: nz(chapter.title_sa),
          $title_iast: nz(chapter.title_iast),
          $title_en: nz(chapter.title_en),
        });
        keptChapterTitleNums.add(chapter.chapter);
      }

      for (const verse of chapter.verses) {
        if (typeof verse.verse_num !== 'number') {
          throw new Error(`${file}: chapter ${chapter.chapter} verse missing 'verse_num'`);
        }
        if (!verse.devanagari) {
          throw new Error(
            `${file}: ${doc.id} ${chapter.chapter}.${verse.verse_num} missing 'devanagari'`,
          );
        }

        // Upsert verse, get id (RETURNING works inside upsert with bun:sqlite).
        const verseRow = stmts.upsertVerse.get({
          $text_id: doc.id,
          $book: nz(verse.book),
          $chapter: chapter.chapter,
          $verse_num: verse.verse_num,
          $devanagari: verse.devanagari,
          $slp1: nz(verse.slp1),
          $iast: nz(verse.iast),
          $meter: nz(verse.meter),
          $manuscript_folio_ref: nz(verse.manuscript_folio_ref),
          $section_type: verse.section_type ?? 'verse',
          $prose_block_ref: nz(verse.prose_block_ref),
        }) as { id: number } | undefined;

        // ON CONFLICT DO UPDATE ... RETURNING is supported in modern SQLite.
        // Fall back to SELECT if for any reason RETURNING returns nothing.
        let verseId: number;
        if (verseRow && typeof verseRow.id === 'number') {
          verseId = verseRow.id;
        } else {
          const r = stmts.selectVerseId.get({
            $text_id: doc.id,
            $chapter: chapter.chapter,
            $verse_num: verse.verse_num,
          }) as { id: number } | undefined;
          if (!r)
            throw new Error(
              `${file}: failed to resolve verse_id for ${doc.id} ${chapter.chapter}.${verse.verse_num}`,
            );
          verseId = r.id;
        }
        verseCount++;
        keptVerseIds.add(verseId);
        const glossKeys = new Set<string>();
        keptGlossKeys.set(verseId, glossKeys);
        const translationKeys = new Set<string>();
        keptTranslationKeys.set(verseId, translationKeys);

        if (Array.isArray(verse.word_glosses)) {
          for (const g of verse.word_glosses) {
            stmts.upsertGloss.run({
              $verse_id: verseId,
              $word_idx: g.word_idx,
              $word_sa: g.word_sa,
              $lemma_sa: nz(g.lemma_sa),
              $lemma_iast: nz(g.lemma_iast),
              $gloss_lang: g.gloss_lang,
              $gloss_text: g.gloss_text,
              $morph: nz(g.morph),
            });
            glossKeys.add(`${g.word_idx}\x1F${g.gloss_lang}`);
            glossCount++;
          }
        }

        if (Array.isArray(verse.translations)) {
          for (const t of verse.translations) {
            // Canonical non-null translator: NULLs are distinct under the
            // (verse_id, lang, translator) UNIQUE key, so leaving NULL here
            // would guarantee duplicate rows on every re-ingest.
            const translator = t.translator?.trim() ? t.translator : DEFAULT_TRANSLATOR;
            stmts.upsertTranslation.run({
              $verse_id: verseId,
              $lang: t.lang,
              $translator: translator,
              $translation_text: t.translation_text,
              $source: nz(t.source),
              $license: t.license,
              $status: t.status,
              $ai_assisted: boolToInt(t.ai_assisted),
              $model: nz(t.model),
              $model_version: nz(t.model_version),
              $prompt_version: nz(t.prompt_version),
              $judge_score: nz(t.judge_score),
              $reviewer: nz(t.reviewer),
              $reviewed_at: nz(t.reviewed_at),
            });
            translationKeys.add(`${t.lang}\x1F${translator}`);
            translationCount++;
          }
        }
      }
    }

    // Declared-count validator: abort (and roll back) when the YAML's
    // expected_verse_count disagrees with what was actually ingested.
    if (typeof doc.expected_verse_count === 'number' && verseCount !== doc.expected_verse_count) {
      throw new Error(
        `${file}: ${doc.id} declares expected_verse_count=${doc.expected_verse_count} but ingested ${verseCount} verses`,
      );
    }

    // Reconciliation pass: delete DB rows for this text that the incoming
    // YAML no longer contains (removed/renumbered verses, dropped glosses
    // or translations). Children first per the FK graph.
    const existingVerses = stmts.selectVerseIdsForText.all({ $text_id: doc.id }) as Array<{
      id: number;
    }>;
    for (const { id } of existingVerses) {
      if (!keptVerseIds.has(id)) {
        stmts.deleteGlossesByVerse.run({ $verse_id: id });
        stmts.deleteTranslationsByVerse.run({ $verse_id: id });
        stmts.deleteParallelsByVerse.run({ $verse_id: id });
        stmts.deleteVerseById.run({ $id: id });
        continue;
      }
      const glossKeys = keptGlossKeys.get(id) ?? new Set<string>();
      const existingGlosses = stmts.selectGlossKeysForVerse.all({ $verse_id: id }) as Array<{
        id: number;
        word_idx: number;
        gloss_lang: string;
      }>;
      for (const g of existingGlosses) {
        if (!glossKeys.has(`${g.word_idx}\x1F${g.gloss_lang}`)) {
          stmts.deleteGlossById.run({ $id: g.id });
        }
      }
      const translationKeys = keptTranslationKeys.get(id) ?? new Set<string>();
      const existingTranslations = stmts.selectTranslationKeysForVerse.all({
        $verse_id: id,
      }) as Array<{ id: number; lang: string; translator: string | null }>;
      for (const t of existingTranslations) {
        // Ingest never writes NULL translators (DEFAULT_TRANSLATOR), so any
        // surviving NULL row is a legacy duplicate — always stale. Everything
        // else reconciles against the kept (lang, translator) keys.
        if (t.translator === null || !translationKeys.has(`${t.lang}\x1F${t.translator}`)) {
          stmts.deleteTranslationById.run({ $id: t.id });
        }
      }
    }

    // Chapter-titles reconciliation: a row whose chapter dropped its titles
    // (or vanished entirely) from the YAML is deleted.
    const existingChapterTitles = stmts.selectChapterTitleNumsForText.all({
      $text_id: doc.id,
    }) as Array<{ chapter: number }>;
    for (const { chapter } of existingChapterTitles) {
      if (!keptChapterTitleNums.has(chapter)) {
        stmts.deleteChapterTitle.run({ $text_id: doc.id, $chapter: chapter });
      }
    }
  });

  runTx();

  return {
    file,
    text_id: doc.id,
    verses: verseCount,
    glosses: glossCount,
    translations: translationCount,
  };
}

// ---------------------------------------------------------------
// Top-level run
// ---------------------------------------------------------------

export interface IngestOptions {
  dbPath?: string;
  corpusDir?: string;
}

export function listYamlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(isCorpusSourceFile)
    .sort()
    .map((f) => join(dir, f));
}

export function openDb(dbPath: string): Database {
  const db = new Database(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

/**
 * WAL hygiene at finalize: fold the -wal sidecar back into the main file,
 * drop back to rollback journaling and compact, so the DB on disk is a
 * single self-contained artifact (no -wal/-shm files left behind for
 * downstream tooling or accidental commits).
 */
export function finalizeDb(db: Database): void {
  const file = (
    db.query("SELECT file FROM pragma_database_list WHERE name = 'main'").get() as
      | { file: string }
      | undefined
  )?.file;
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  db.exec('PRAGMA journal_mode = DELETE;');
  db.exec('VACUUM;');
  db.close();
  // SQLite removes the -wal on the journal-mode downgrade but can leave a
  // stale -shm behind on some platforms; sweep both defensively. In-memory
  // DBs report an empty `file` and are skipped.
  if (file) {
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = `${file}${suffix}`;
      if (existsSync(sidecar)) rmSync(sidecar);
    }
  }
}

/**
 * Order parsed texts so parents land before children. `texts.parent_text_id`
 * is a self-FK, so a commentary whose YAML filename sorts before its parent
 * would otherwise FK-fail on a fresh DB. Parents that are not part of the
 * batch (already in the DB) are treated as satisfied; the FK still verifies
 * them at insert time. Stable: alphabetical file order is preserved within
 * each dependency layer.
 */
export function topoSortTexts<T extends { doc: TextYaml }>(entries: T[]): T[] {
  const batchIds = new Set(entries.map((e) => e.doc.id));
  const emitted = new Set<string>();
  const pending = [...entries];
  const out: T[] = [];
  while (pending.length > 0) {
    let progressed = false;
    for (let i = 0; i < pending.length; ) {
      const parent = pending[i].doc.parent_text_id;
      if (!parent || !batchIds.has(parent) || emitted.has(parent)) {
        const [entry] = pending.splice(i, 1);
        out.push(entry);
        emitted.add(entry.doc.id);
        progressed = true;
      } else {
        i++;
      }
    }
    if (!progressed) {
      const stuck = pending.map((e) => e.doc.id).join(', ');
      throw new Error(`parent_text_id cycle detected among texts: ${stuck}`);
    }
  }
  return out;
}

export function run(opts: IngestOptions = {}): RunSummary {
  const dbPath = opts.dbPath ?? DEFAULT_DB_PATH;
  const corpusDir = opts.corpusDir ?? DEFAULT_CORPUS_DIR;

  if (!existsSync(dbPath)) {
    throw new Error(`DB not found at ${dbPath}. Run \`bun pipeline/ingest/init-db.ts\` first.`);
  }

  const db = openDb(dbPath);
  const stmts = prepareStatements(db);

  const files = listYamlFiles(corpusDir);
  if (files.length === 0) {
    console.log(`No YAML files found in ${corpusDir}.`);
    finalizeDb(db);
    return { files: [], total_verses: 0, total_texts: 0, total_glosses: 0, total_translations: 0 };
  }

  // Parse everything first, then topo-sort by parent_text_id so commentary
  // texts ingest after the text they annotate regardless of filename order.
  const parsed: Array<{ file: string; doc: TextYaml }> = [];
  for (const file of files) {
    try {
      parsed.push({ file, doc: parseTextYaml(file) });
    } catch (err) {
      console.error(`FAILED ${file}:`, err instanceof Error ? err.message : err);
      throw err;
    }
  }

  const stats: FileStats[] = [];

  for (const { file, doc } of topoSortTexts(parsed)) {
    try {
      const s = ingestText(db, stmts, doc, file);
      stats.push(s);
      console.log(
        `Ingested ${s.verses} verses, ${s.glosses} glosses, ${s.translations} translations  (${doc.id} <- ${file.replace(`${PROJECT_ROOT}/`, '')})`,
      );
    } catch (err) {
      console.error(`FAILED ${file}:`, err instanceof Error ? err.message : err);
      throw err;
    }
  }

  finalizeDb(db);

  const totalVerses = stats.reduce((a, s) => a + s.verses, 0);
  const totalGlosses = stats.reduce((a, s) => a + s.glosses, 0);
  const totalTranslations = stats.reduce((a, s) => a + s.translations, 0);

  console.log(
    `\nTotal: ${totalVerses} verses across ${stats.length} texts  (${totalGlosses} glosses, ${totalTranslations} translations)`,
  );

  return {
    files: stats,
    total_verses: totalVerses,
    total_texts: stats.length,
    total_glosses: totalGlosses,
    total_translations: totalTranslations,
  };
}

export function parseArgs(argv: string[]): IngestOptions {
  const opts: IngestOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--db' && argv[i + 1]) opts.dbPath = argv[++i];
    else if (a === '--dir' && argv[i + 1]) opts.corpusDir = argv[++i];
  }
  return opts;
}

export async function main() {
  const opts = parseArgs(Bun.argv.slice(2));
  run(opts);
}

// Bun: execute when run directly (not when imported by tests).
if (import.meta.main) {
  main();
}
