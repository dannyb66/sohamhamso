import {
  getDb,
  getText,
  getVerse,
  getVerseAllLanguages,
  listAllVerses,
  listTexts,
  type Text,
  type TextSummary,
  type VersePageData,
} from '../db';
import type { LangCode } from '../reading-modes';
import { isLangCode } from './i18n-routes';
import { assignLemmaSlug } from './slug';

type VerseRoute = {
  chapter: number;
  tradition: string;
  text: string;
  verse: number;
};

export interface LemmaSummary {
  firstVerseId: number;
  lemmaIast: string;
  lemmaSa: string | null;
  occurrenceCount: number;
  slug: string;
}

export interface LemmaRoute {
  slug: string;
}

export interface LemmaOccurrence {
  basePath: string;
  chapter: number;
  devanagari: string;
  glossLang: LangCode;
  glossText: string | null;
  iast: string | null;
  textSlug: string;
  textTitleEn: string;
  tradition: string;
  verse: number;
}

export interface LemmaPageData {
  availableLangs: LangCode[];
  gloss: string;
  glossLang: LangCode;
  lemmaIast: string;
  lemmaSa: string | null;
  morphologies: string[];
  occurrenceCount: number;
  occurrences: LemmaOccurrence[];
  samplePath: string;
  slug: string;
}

interface LemmaSeedRow {
  first_verse_id: number;
  lemma_iast: string;
  lemma_sa: string | null;
  occurrence_count: number;
}

interface LemmaGlossRow {
  gloss_lang: string;
  gloss_text: string;
}

interface LemmaOccurrenceRow {
  chapter: number;
  devanagari: string;
  english_gloss: string | null;
  iast: string | null;
  requested_gloss: string | null;
  text_slug: string;
  text_title_en: string;
  tradition: string;
  verse_num: number;
}

const textCache = new Map<string, Text | null>();
const verseRouteCache: VerseRoute[] = [];
const verseAvailabilityCache = new Map<string, LangCode[]>();
const versePageCache = new Map<string, VersePageData | null>();
const lemmaBySlugCache = new Map<string, LemmaSummary>();
const lemmaByIastCache = new Map<string, LemmaSummary>();
const lemmaPageCache = new Map<string, LemmaPageData | null>();

export function getTexts(): TextSummary[] {
  return listTexts();
}

export function getTextCached(slug: string): Text | null {
  if (!textCache.has(slug)) {
    textCache.set(slug, getText(slug));
  }
  return textCache.get(slug) ?? null;
}

export function getCanonicalVerseRoutes(): VerseRoute[] {
  if (verseRouteCache.length > 0) return verseRouteCache;
  for (const text of listTexts()) {
    for (const verse of listAllVerses(text.slug)) {
      verseRouteCache.push({
        chapter: verse.chapter,
        tradition: text.tradition,
        text: text.slug,
        verse: verse.verse_num,
      });
    }
  }
  return verseRouteCache;
}

export function getVerseAvailability(textSlug: string, chapter: number, verseNum: number): LangCode[] {
  const key = `${textSlug}:${chapter}:${verseNum}`;
  const cached = verseAvailabilityCache.get(key);
  if (cached) return cached;
  const bundle = getVerseAllLanguages(textSlug, chapter, verseNum);
  const langs = Object.keys(bundle?.translations_by_lang ?? {}).sort() as LangCode[];
  if (!langs.includes('en')) langs.unshift('en');
  verseAvailabilityCache.set(key, langs);
  return langs;
}

export function getVersePageCached(
  textSlug: string,
  chapter: number,
  verseNum: number,
  lang: LangCode,
): VersePageData | null {
  const key = `${textSlug}:${chapter}:${verseNum}:${lang}`;
  if (!versePageCache.has(key)) {
    versePageCache.set(key, getVerse(textSlug, chapter, verseNum, lang));
  }
  return versePageCache.get(key) ?? null;
}

function ensureLemmaIndex(): void {
  if (lemmaBySlugCache.size > 0) return;
  const rows = getDb()
    .query<LemmaSeedRow, []>(`
      SELECT
        g.lemma_iast,
        MIN(g.lemma_sa) AS lemma_sa,
        COUNT(DISTINCT g.verse_id) AS occurrence_count,
        MIN(g.verse_id) AS first_verse_id
      FROM word_glosses g
      WHERE g.lemma_iast IS NOT NULL
        AND TRIM(g.lemma_iast) != ''
      GROUP BY g.lemma_iast
      ORDER BY MIN(g.verse_id) ASC, g.lemma_iast ASC
    `)
    .all();

  const seen = new Set<string>();
  for (const row of rows) {
    const slug = assignLemmaSlug(row.lemma_iast, seen);
    seen.add(slug);
    const summary: LemmaSummary = {
      firstVerseId: row.first_verse_id,
      lemmaIast: row.lemma_iast,
      lemmaSa: row.lemma_sa,
      occurrenceCount: row.occurrence_count,
      slug,
    };
    lemmaBySlugCache.set(slug, summary);
    lemmaByIastCache.set(summary.lemmaIast, summary);
  }
}

function normalizeLemmaLangs(rows: Array<{ gloss_lang: string }>): LangCode[] {
  const langs = rows
    .map((row) => row.gloss_lang)
    .filter(isLangCode)
    .sort() as LangCode[];
  if (!langs.includes('en')) langs.unshift('en');
  return langs;
}

export function getLemmaRoutes(): LemmaRoute[] {
  ensureLemmaIndex();
  return [...lemmaBySlugCache.values()]
    .filter((lemma) => lemma.occurrenceCount >= 3)
    .map((lemma) => ({ slug: lemma.slug }));
}

export function getLemmaSummaryBySlug(slug: string): LemmaSummary | null {
  ensureLemmaIndex();
  return lemmaBySlugCache.get(slug) ?? null;
}

export function getLemmaSummaryByIast(lemmaIast: string): LemmaSummary | null {
  ensureLemmaIndex();
  return lemmaByIastCache.get(lemmaIast) ?? null;
}

export function getLemmaPageCached(slug: string, lang: LangCode): LemmaPageData | null {
  const key = `${slug}:${lang}`;
  if (lemmaPageCache.has(key)) return lemmaPageCache.get(key) ?? null;

  ensureLemmaIndex();
  const summary = lemmaBySlugCache.get(slug);
  if (!summary || summary.occurrenceCount < 3) {
    lemmaPageCache.set(key, null);
    return null;
  }

  const db = getDb();
  const availableLangRows = db
    .query<{ gloss_lang: string }, [string]>(`
      SELECT DISTINCT g.gloss_lang
      FROM word_glosses g
      WHERE g.lemma_iast = ?
        AND g.gloss_lang IS NOT NULL
        AND TRIM(g.gloss_lang) != ''
      ORDER BY g.gloss_lang ASC
    `)
    .all(summary.lemmaIast);
  const availableLangs = normalizeLemmaLangs(availableLangRows);

  const glossRows = db
    .query<LemmaGlossRow, [string, string, string]>(`
      SELECT g.gloss_lang, g.gloss_text
      FROM word_glosses g
      WHERE g.lemma_iast = ?
        AND g.gloss_lang IN (?, 'en')
      ORDER BY CASE WHEN g.gloss_lang = ? THEN 0 ELSE 1 END, g.verse_id ASC, g.word_idx ASC
    `)
    .all(summary.lemmaIast, lang, lang);
  const requestedGloss = glossRows.find((row) => row.gloss_lang === lang)?.gloss_text?.trim() || null;
  const englishGloss = glossRows.find((row) => row.gloss_lang === 'en')?.gloss_text?.trim() || null;
  const gloss = requestedGloss ?? englishGloss;
  if (!gloss) {
    lemmaPageCache.set(key, null);
    return null;
  }

  const morphologies = db
    .query<{ morph: string }, [string]>(`
      SELECT DISTINCT g.morph
      FROM word_glosses g
      WHERE g.lemma_iast = ?
        AND g.morph IS NOT NULL
        AND TRIM(g.morph) != ''
      ORDER BY g.morph ASC
    `)
    .all(summary.lemmaIast)
    .map((row) => row.morph);

  const occurrences = db
    .query<LemmaOccurrenceRow, [string, string, string, string]>(`
      SELECT
        t.tradition,
        t.slug AS text_slug,
        t.title_en AS text_title_en,
        v.chapter,
        v.verse_num,
        v.devanagari,
        v.iast,
        (
          SELECT g2.gloss_text
          FROM word_glosses g2
          WHERE g2.verse_id = v.id
            AND g2.lemma_iast = ?
            AND g2.gloss_lang = ?
          ORDER BY g2.word_idx ASC
          LIMIT 1
        ) AS requested_gloss,
        (
          SELECT g3.gloss_text
          FROM word_glosses g3
          WHERE g3.verse_id = v.id
            AND g3.lemma_iast = ?
            AND g3.gloss_lang = 'en'
          ORDER BY g3.word_idx ASC
          LIMIT 1
        ) AS english_gloss
      FROM verses v
      JOIN texts t ON t.id = v.text_id
      WHERE EXISTS (
        SELECT 1
        FROM word_glosses g
        WHERE g.verse_id = v.id
          AND g.lemma_iast = ?
      )
      ORDER BY v.id ASC
    `)
    .all(summary.lemmaIast, lang, summary.lemmaIast, summary.lemmaIast)
    .map((row) => ({
      basePath: `/${row.tradition}/${row.text_slug}/${row.chapter}/${row.verse_num}`,
      chapter: row.chapter,
      devanagari: row.devanagari,
      glossLang: row.requested_gloss ? lang : 'en',
      glossText: row.requested_gloss ?? row.english_gloss,
      iast: row.iast,
      textSlug: row.text_slug,
      textTitleEn: row.text_title_en,
      tradition: row.tradition,
      verse: row.verse_num,
    }));

  const result: LemmaPageData = {
    availableLangs,
    gloss,
    glossLang: requestedGloss ? lang : 'en',
    lemmaIast: summary.lemmaIast,
    lemmaSa: summary.lemmaSa,
    morphologies,
    occurrenceCount: summary.occurrenceCount,
    occurrences,
    samplePath: occurrences[0]?.basePath ?? '/',
    slug: summary.slug,
  };
  lemmaPageCache.set(key, result);
  return result;
}
