/**
 * seo-build-og-cache — precompute verse OG payloads to static JSON.
 *
 * Build-time output for the legacy OG cache. The deployed OG renderer reads
 * generated corpus assets and never connects to a remote corpus database.
 *
 * Output shape:
 *   One JSON per verse, mirroring `getVerseAllLanguages` raw row shape:
 *   {
 *     "tradition": "trika",
 *     "textSlug": "pratyabhijna-hrdayam",
 *     "titleEn": "The Heart of Recognition",
 *     "titleSa": "प्रत्यभिज्ञाहृदयम्",
 *     "chapter": 1,
 *     "verseNum": 6,
 *     "devanagari": "तन्मयो मायाप्रमाता ॥६॥",
 *     "iast": "tan-mayo māyā-pramātā",
 *     "translationsByLang": {
 *       "en": { "translationText": "...", "translator": "..." },
 *       "hi": { ... }, ...
 *     }
 *   }
 *
 *   The OG handler runs the same requested→english fallback logic
 *   against this raw shape that `fetchVerseOgPayload` runs against the
 *   DB row. Keeping it raw lets us add new langs / new query columns
 *   without forcing a rebuild of the cache writer.
 *
 * Lemma OG: out of scope. The 3 T+24h failures were all verse routes;
 *   lemma routes use a different query path and weren't affected.
 *
 * Runtime: bun (build-time only). Reads `db/sohamhamso.db` directly via
 *   `bun:sqlite`. Never imported at the edge.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from '../src/lib/db';

const OG_CACHE_DIR = 'public/og-cache';

interface VerseRow {
  tradition: string;
  text_slug: string;
  title_en: string;
  title_sa: string;
  verse_id: number;
  chapter: number;
  verse_num: number;
  devanagari: string;
  iast: string | null;
}

interface TranslationRow {
  verse_id: number;
  lang: string;
  translation_text: string;
  translator: string | null;
  ai_assisted: number;
  status: string;
  created_at: string;
}

export interface CachedTranslation {
  translationText: string;
  translator: string | null;
}

export interface CachedVerseOg {
  tradition: string;
  textSlug: string;
  titleEn: string;
  titleSa: string;
  chapter: number;
  verseNum: number;
  devanagari: string;
  iast: string | null;
  translationsByLang: Record<string, CachedTranslation>;
}

/**
 * Build the OG cache: one verse row + its translations bundled into a
 * single JSON file per verse. Returns the list of files written.
 *
 * Selection logic mirrors `fetchVerseOgPayload` in `src/lib/seo/og-payload.ts`:
 *   - status IN ('published', 'reviewed', 'draft')
 *   - per-lang: prefer ai_assisted=0, then status, then created_at ASC
 *
 * We keep ALL languages per verse in one file so the OG handler can run
 * the requested→english fallback at request time without a second lookup.
 */
export function buildOgCachePayloads(db = getDb()): Map<string, CachedVerseOg> {
  const verses = db
    .query<VerseRow, []>(`
      SELECT
        t.tradition,
        t.slug AS text_slug,
        t.title_en,
        t.title_sa,
        v.id AS verse_id,
        v.chapter,
        v.verse_num,
        v.devanagari,
        v.iast
      FROM verses v
      JOIN texts t ON t.id = v.text_id
      ORDER BY t.slug ASC, v.chapter ASC, v.verse_num ASC
    `)
    .all();

  const translations = db
    .query<TranslationRow, []>(`
      SELECT
        verse_id,
        lang,
        translation_text,
        translator,
        ai_assisted,
        status,
        created_at
      FROM translations
      WHERE status IN ('published', 'reviewed', 'draft')
      ORDER BY verse_id ASC, lang ASC, ai_assisted ASC, status ASC, created_at ASC
    `)
    .all();

  // Group translations by verse_id, keeping the FIRST row per lang
  // (matches the LIMIT 1 + ORDER BY in fetchVerseOgPayload's subqueries).
  const translationsByVerse = new Map<number, Map<string, CachedTranslation>>();
  for (const row of translations) {
    let langMap = translationsByVerse.get(row.verse_id);
    if (!langMap) {
      langMap = new Map();
      translationsByVerse.set(row.verse_id, langMap);
    }
    if (langMap.has(row.lang)) continue; // keep first per lang
    langMap.set(row.lang, {
      translationText: row.translation_text,
      translator: row.translator,
    });
  }

  const payloads = new Map<string, CachedVerseOg>();
  for (const v of verses) {
    const langMap = translationsByVerse.get(v.verse_id) ?? new Map<string, CachedTranslation>();
    const translationsByLang: Record<string, CachedTranslation> = {};
    // Stable key order (alphabetical) — keeps diffs sensible across rebuilds.
    for (const lang of [...langMap.keys()].sort()) {
      const tr = langMap.get(lang);
      if (tr) translationsByLang[lang] = tr;
    }
    const key = cacheKey(v.tradition, v.text_slug, v.chapter, v.verse_num);
    payloads.set(key, {
      tradition: v.tradition,
      textSlug: v.text_slug,
      titleEn: v.title_en,
      titleSa: v.title_sa,
      chapter: v.chapter,
      verseNum: v.verse_num,
      devanagari: v.devanagari,
      iast: v.iast,
      translationsByLang,
    });
  }
  return payloads;
}

/**
 * Cache key = path-relative-to-cache-dir, identical to the OG route shape:
 *   `<tradition>/<text>/<chapter>/<verse>.json`
 */
export function cacheKey(
  tradition: string,
  textSlug: string,
  chapter: number,
  verse: number,
): string {
  return `${tradition}/${textSlug}/${chapter}/${verse}.json`;
}

/**
 * Write the precomputed payloads to disk under `public/og-cache/`.
 * Returns the absolute output directory.
 */
export async function writeOgCacheFiles(outputDir = OG_CACHE_DIR): Promise<{
  outputDir: string;
  filesWritten: number;
}> {
  const resolvedDir = path.resolve(process.cwd(), outputDir);
  const payloads = buildOgCachePayloads();

  let filesWritten = 0;
  for (const [key, payload] of payloads) {
    const filePath = path.join(resolvedDir, key);
    await mkdir(path.dirname(filePath), { recursive: true });
    // Compact JSON — saves ~30% on bundle size vs pretty-printed. The
    // OG handler parses these on the hot path so smaller bytes = faster
    // edge serve + parse.
    await writeFile(filePath, JSON.stringify(payload), 'utf8');
    filesWritten++;
  }
  return { outputDir: resolvedDir, filesWritten };
}

const entrypointPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const currentModulePath = fileURLToPath(import.meta.url);

if (entrypointPath === currentModulePath) {
  const outputDir = process.argv[2] ?? OG_CACHE_DIR;
  const { outputDir: written, filesWritten } = await writeOgCacheFiles(outputDir);
  console.log(`Wrote ${filesWritten} OG cache files to ${written}`);
}
