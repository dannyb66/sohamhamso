#!/usr/bin/env bun
/**
 * Export the public corpus into bounded static JSON bundles.
 *
 * This runs after Astro's local build and never connects to Turso, D1, or any
 * other network service. Bundles are split by text/chapter so Pages does not
 * receive one oversized database asset and the browser can load only the
 * chapter it needs.
 */

import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assignLemmaSlug } from '../src/lib/seo/slug';

type Row = Record<string, unknown>;
type TextRow = Row & {
  id: string;
  slug: string;
  title_en: string;
  tradition: string;
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.env.SOHAMHAMSO_DB_PATH ?? join(root, 'db', 'sohamhamso.db');
const outDir = resolve(process.env.STATIC_CORPUS_OUT ?? join(root, 'dist', '_data', 'corpus'));

function rows<T extends Row>(db: Database, sql: string, params: unknown[] = []): T[] {
  // Bun's SQLite tuple typing is intentionally kept inside this exporter.
  // biome-ignore lint/suspicious/noExplicitAny: SQLite query parameters are heterogeneous.
  return db.query<T, any>(sql).all(...(params as any[])) as T[];
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value)}\n`, 'utf8');
}

const db = new Database(dbPath, { readonly: true });
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const texts = rows<TextRow>(db, 'SELECT * FROM texts ORDER BY slug');

const manifest: {
  version: 1;
  generated_at: string;
  texts: Array<{ slug: string; title_en: string; tradition: string; chapters: number[] }>;
  search_languages: string[];
} = { version: 1, generated_at: new Date().toISOString(), texts: [], search_languages: [] };
manifest.search_languages = rows<{ lang: string }>(
  db,
  "SELECT DISTINCT lang FROM translations WHERE status IN ('published', 'reviewed') ORDER BY lang",
).map((row) => row.lang);

let bundleCount = 0;
for (const text of texts) {
  const chapters = rows<{ chapter: number }>(
    db,
    'SELECT DISTINCT chapter FROM verses WHERE text_id = ? ORDER BY chapter',
    [text.id],
  ).map((row) => row.chapter);

  manifest.texts.push({
    slug: text.slug,
    title_en: text.title_en,
    tradition: text.tradition,
    chapters,
  });

  for (const chapter of chapters) {
    const verses = rows<Row>(
      db,
      'SELECT * FROM verses WHERE text_id = ? AND chapter = ? ORDER BY verse_num',
      [text.id, chapter],
    );
    const verseIds = verses.map((verse) => Number(verse.id));
    const placeholders = verseIds.map(() => '?').join(',');
    const translations = verseIds.length
      ? rows<Row>(
          db,
          `SELECT * FROM translations WHERE verse_id IN (${placeholders})
           AND status IN ('published', 'reviewed')
           ORDER BY verse_id, lang, CASE status WHEN 'reviewed' THEN 0 ELSE 1 END, ai_assisted ASC, created_at ASC`,
          verseIds,
        )
      : [];
    const glosses = verseIds.length
      ? rows<Row>(
          db,
          `SELECT * FROM word_glosses WHERE verse_id IN (${placeholders})
           ORDER BY verse_id, gloss_lang, word_idx`,
          verseIds,
        )
      : [];
    const parallels = verseIds.length
      ? rows<Row>(
          db,
          `SELECT p.*, tt.slug AS target_text_slug, tt.title_en AS target_text_title,
             tv.chapter AS target_chapter, tv.verse_num AS target_verse_num,
             tv.devanagari AS target_devanagari, tv.iast AS target_iast
           FROM parallels p
           JOIN verses tv ON tv.id = p.target_verse_id
           JOIN texts tt ON tt.id = tv.text_id
           WHERE p.source_verse_id IN (${placeholders})
           ORDER BY p.source_verse_id, p.confidence DESC`,
          verseIds,
        )
      : [];

    writeJson(join(outDir, text.slug, `${chapter}.json`), {
      version: 1,
      text,
      chapter,
      verses,
      translations,
      glosses,
      parallels,
    });
    bundleCount += 1;
  }
}

for (const lang of manifest.search_languages) {
  const searchRows = rows<Row>(
    db,
    `SELECT v.id AS verse_id, t.id AS text_id, t.slug AS text_slug, t.title_en AS text_title,
       t.tradition, v.chapter, v.verse_num, v.devanagari, v.iast,
       tr.translation_text AS search_text,
       substr(tr.translation_text, 1, 240) AS translation_excerpt
     FROM verses v
     JOIN texts t ON t.id = v.text_id
     JOIN translations tr ON tr.verse_id = v.id AND tr.lang = ?
     WHERE tr.status IN ('published', 'reviewed')
     ORDER BY v.id, CASE tr.status WHEN 'reviewed' THEN 0 ELSE 1 END, tr.ai_assisted ASC, tr.created_at ASC`,
    [lang],
  );
  writeJson(join(outDir, 'search', `${lang}.json`), {
    version: 1,
    lang,
    rows: searchRows,
  });
}

const lemmaSeeds = rows<{
  lemma_iast: string;
  lemma_sa: string | null;
  occurrence_count: number;
  first_verse_id: number;
}>(
  db,
  `SELECT g.lemma_iast, MIN(g.lemma_sa) AS lemma_sa,
      COUNT(DISTINCT g.verse_id) AS occurrence_count,
      MIN(g.verse_id) AS first_verse_id
   FROM word_glosses g
   WHERE g.lemma_iast IS NOT NULL AND TRIM(g.lemma_iast) != ''
   GROUP BY g.lemma_iast
   ORDER BY MIN(g.verse_id), g.lemma_iast`,
);
const textOccurrences = rows<{ lemma_iast: string; text_id: string; occurrence_count: number }>(
  db,
  `SELECT g.lemma_iast, v.text_id, COUNT(DISTINCT g.verse_id) AS occurrence_count
   FROM word_glosses g JOIN verses v ON v.id = g.verse_id
   WHERE g.lemma_iast IS NOT NULL AND TRIM(g.lemma_iast) != ''
   GROUP BY g.lemma_iast, v.text_id`,
);
const occurrencesByLemma = new Map<string, Record<string, number>>();
for (const row of textOccurrences) {
  const counts = occurrencesByLemma.get(row.lemma_iast) ?? {};
  counts[row.text_id] = row.occurrence_count;
  occurrencesByLemma.set(row.lemma_iast, counts);
}
const firstGlosses = rows<{ lemma_iast: string; gloss_lang: string; gloss_text: string }>(
  db,
  `SELECT g.lemma_iast, g.gloss_lang, g.gloss_text
   FROM word_glosses g
   JOIN (
     SELECT lemma_iast, gloss_lang, MIN(id) AS id
     FROM word_glosses
     WHERE lemma_iast IS NOT NULL AND TRIM(lemma_iast) != ''
     GROUP BY lemma_iast, gloss_lang
   ) first ON first.id = g.id
   ORDER BY g.lemma_iast, g.gloss_lang`,
);
const glossesByLemma = new Map<string, Record<string, string>>();
for (const gloss of firstGlosses) {
  const values = glossesByLemma.get(gloss.lemma_iast) ?? {};
  values[gloss.gloss_lang] = gloss.gloss_text;
  glossesByLemma.set(gloss.lemma_iast, values);
}
const seenLemmaSlugs = new Set<string>();
const lemmaRows = lemmaSeeds.map((lemma) => {
  const slug = assignLemmaSlug(lemma.lemma_iast, seenLemmaSlugs);
  seenLemmaSlugs.add(slug);
  const sample = rows<{
    tradition: string;
    text_slug: string;
    chapter: number;
    verse_num: number;
  }>(
    db,
    `SELECT t.tradition, t.slug AS text_slug, v.chapter, v.verse_num
     FROM verses v JOIN texts t ON t.id = v.text_id WHERE v.id = ? LIMIT 1`,
    [lemma.first_verse_id],
  )[0];
  return {
    slug,
    lemma_iast: lemma.lemma_iast,
    lemma_sa: lemma.lemma_sa,
    occurrence_count: lemma.occurrence_count,
    text_occurrences: occurrencesByLemma.get(lemma.lemma_iast) ?? {},
    glosses: glossesByLemma.get(lemma.lemma_iast) ?? {},
    sample,
  };
});
writeJson(join(outDir, 'lemmas.json'), {
  version: 1,
  rows: lemmaRows.filter((item) => item.occurrence_count >= 3),
});
writeJson(join(outDir, 'lemma-summaries.json'), {
  version: 1,
  rows: lemmaRows.map(({ slug, lemma_iast, occurrence_count, text_occurrences }) => ({
    slug,
    lemma_iast,
    occurrence_count,
    text_occurrences,
  })),
});

writeJson(join(outDir, 'manifest.json'), manifest);
db.close();

// Astro creates this file before the post-build export. Ensure the CDN serves
// generated corpus files directly rather than sending them through Astro.
const routesPath = join(root, 'dist', '_routes.json');
if (outDir === join(root, 'dist', '_data', 'corpus') && existsSync(routesPath)) {
  const routes = JSON.parse(readFileSync(routesPath, 'utf8'));
  routes.exclude = [...new Set([...(routes.exclude ?? []), '/_data/*'])];
  writeJson(routesPath, routes);
}

console.log(
  `Exported ${texts.length} texts into ${bundleCount} static chapter bundles at ${outDir}`,
);
