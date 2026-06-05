#!/usr/bin/env bun
/**
 * sohamhamso — YAML corpus ingestion
 *
 * Reads `data/corpus/*.yaml` and upserts rows into the local SQLite DB
 * at `db/sohamhamso.db`. Idempotent: re-running does not duplicate.
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
 *       verses:
 *         - verse_num: 1
 *           devanagari: "..."
 *           slp1: "..."
 *           iast: "..."
 *           meter: anushtubh
 *           book: 1                       # optional
 *           manuscript_folio_ref: "..."  # optional
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
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
  word_glosses?: WordGlossYaml[];
  translations?: TranslationYaml[];
}

export interface ChapterYaml {
  chapter: number;
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
  chapters: ChapterYaml[];
}

function isCorpusSourceFile(name: string): boolean {
  return (name.endsWith('.yaml') || name.endsWith('.yml')) && !/\.faq\.ya?ml$/i.test(name) && !name.startsWith('_');
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
  `);

  const upsertVerse = db.prepare(`
    INSERT INTO verses (
      text_id, book, chapter, verse_num, devanagari, slp1, iast, meter, manuscript_folio_ref
    ) VALUES (
      $text_id, $book, $chapter, $verse_num, $devanagari, $slp1, $iast, $meter, $manuscript_folio_ref
    )
    ON CONFLICT(text_id, chapter, verse_num) DO UPDATE SET
      book = excluded.book,
      devanagari = excluded.devanagari,
      slp1 = excluded.slp1,
      iast = excluded.iast,
      meter = excluded.meter,
      manuscript_folio_ref = excluded.manuscript_folio_ref
    RETURNING id
  `);

  const selectVerseId = db.prepare(`
    SELECT id FROM verses WHERE text_id = $text_id AND chapter = $chapter AND verse_num = $verse_num
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
  `);

  return { upsertText, upsertVerse, selectVerseId, upsertGloss, upsertTranslation };
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
            glossCount++;
          }
        }

        if (Array.isArray(verse.translations)) {
          for (const t of verse.translations) {
            stmts.upsertTranslation.run({
              $verse_id: verseId,
              $lang: t.lang,
              $translator: nz(t.translator),
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
            translationCount++;
          }
        }
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
    db.close();
    return { files: [], total_verses: 0, total_texts: 0, total_glosses: 0, total_translations: 0 };
  }

  const stats: FileStats[] = [];

  for (const file of files) {
    try {
      const doc = parseTextYaml(file);
      const s = ingestText(db, stmts, doc, file);
      stats.push(s);
      console.log(
        `Ingested ${s.verses} verses, ${s.glosses} glosses, ${s.translations} translations  (${doc.id} <- ${file.replace(PROJECT_ROOT + '/', '')})`,
      );
    } catch (err) {
      console.error(`FAILED ${file}:`, err instanceof Error ? err.message : err);
      throw err;
    }
  }

  db.close();

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
