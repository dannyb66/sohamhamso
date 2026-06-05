import type { CorpusDb } from '../corpus-db';
import { READING_MODES, type LangCode } from '../reading-modes';
import { asciiStrip, assignLemmaSlug, slugifyLemmaBase } from './slug';

export const OG_SITE_URL = 'https://sohamhamso.org';
export const OG_DEFAULT_LANG: LangCode = 'en';
export const OG_KNOWN_TRADITIONS = ['trika', 'shakta', 'kaula', 'shaiva'] as const;

type OgKnownTradition = (typeof OG_KNOWN_TRADITIONS)[number];

const OG_LANGS = new Set<LangCode>(READING_MODES.map((mode) => mode.langCode));
const OG_TRADITIONS = new Set<OgKnownTradition>(OG_KNOWN_TRADITIONS);
const OG_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const OG_POSITIVE_INT_RE = /^\d+$/;
const TRANSLATION_STATUS_SQL = "('published', 'reviewed', 'draft')";

export interface OgRouteValidationError {
  ok: false;
  status: 400 | 404;
  code:
    | 'invalid_path'
    | 'invalid_lang'
    | 'invalid_slug'
    | 'invalid_tradition'
    | 'invalid_number';
  message: string;
}

export interface VerseOgRoute {
  ok: true;
  kind: 'verse';
  tradition: OgKnownTradition;
  textSlug: string;
  chapter: number;
  verse: number;
  lang: LangCode;
  sourcePath: string;
  pagePath: string;
  pageUrl: string;
  cacheKeyUrl: string;
}

export interface LemmaOgRoute {
  ok: true;
  kind: 'lemma';
  slug: string;
  lang: LangCode;
  sourcePath: string;
  pagePath: string;
  pageUrl: string;
  cacheKeyUrl: string;
}

export type ParsedOgRoute = VerseOgRoute | LemmaOgRoute;
export type OgRouteParseResult = ParsedOgRoute | OgRouteValidationError;
export type VerseOgRouteParseResult = VerseOgRoute | OgRouteValidationError;
export type LemmaOgRouteParseResult = LemmaOgRoute | OgRouteValidationError;

export interface VerseOgPayload {
  kind: 'verse';
  route: VerseOgRoute;
  textTitleEn: string;
  textTitleSa: string;
  tradition: string;
  citation: string;
  devanagari: string;
  iast: string | null;
  translation: string | null;
  translationLang: LangCode | null;
  translator: string | null;
  secondaryText: string;
  secondaryTextKind: 'iast' | 'translation';
  secondaryTextLang: LangCode;
  fallbackUsed: boolean;
}

export interface LemmaOgPayload {
  kind: 'lemma';
  route: LemmaOgRoute;
  slug: string;
  lemmaIast: string;
  lemmaSa: string | null;
  gloss: string;
  glossLang: LangCode;
  occurrenceCount: number;
  samplePath: string;
  sampleUrl: string;
  fallbackUsed: boolean;
}

interface LemmaSeedRow {
  lemma_iast: string;
  lemma_sa: string | null;
  occurrence_count: number;
  first_verse_id: number;
}

interface LemmaIndexEntry {
  slug: string;
  lemmaIast: string;
  lemmaSa: string | null;
  occurrenceCount: number;
  firstVerseId: number;
}

let _lemmaIndexPromise: Promise<Map<string, LemmaIndexEntry>> | null = null;

export function isOgLang(value: string | null | undefined): value is LangCode {
  return typeof value === 'string' && OG_LANGS.has(value as LangCode);
}

export function buildOgCacheKeyUrl(pathname: string, lang: LangCode, origin = OG_SITE_URL): string {
  const url = new URL(pathname, origin);
  if (lang !== OG_DEFAULT_LANG) {
    url.searchParams.set('lang', lang);
  }
  return url.toString();
}

export { asciiStrip, assignLemmaSlug, slugifyLemmaBase } from './slug';

export function parseVerseOgUrl(url: URL): VerseOgRouteParseResult {
  const lang = parseOgLang(url);
  if (!lang.ok) return lang;

  const segments = pathnameSegments(url.pathname);
  if (segments.length !== 5 || segments[0] !== 'og') {
    return invalidOgRoute(404, 'invalid_path', 'Verse OG path must be /og/{tradition}/{text}/{chapter}/{verse}.');
  }

  const tradition = segments[1];
  const textSlug = segments[2];
  const chapterRaw = segments[3];
  const verseRaw = segments[4];

  if (!OG_TRADITIONS.has(tradition as OgKnownTradition)) {
    return invalidOgRoute(404, 'invalid_tradition', `Unknown OG tradition: ${tradition}.`);
  }
  if (!OG_SLUG_RE.test(textSlug)) {
    return invalidOgRoute(404, 'invalid_slug', `Invalid OG text slug: ${textSlug}.`);
  }

  const chapter = parsePositiveIntSegment(chapterRaw);
  if (chapter === null) {
    return invalidOgRoute(404, 'invalid_number', `Invalid OG chapter: ${chapterRaw}.`);
  }

  const verse = parsePositiveIntSegment(verseRaw);
  if (verse === null) {
    return invalidOgRoute(404, 'invalid_number', `Invalid OG verse: ${verseRaw}.`);
  }

  const sourcePath = `/og/${tradition}/${textSlug}/${chapter}/${verse}`;
  const pagePath = buildVersePagePath(tradition as OgKnownTradition, textSlug, chapter, verse, lang.value);

  return {
    ok: true,
    kind: 'verse',
    tradition: tradition as OgKnownTradition,
    textSlug,
    chapter,
    verse,
    lang: lang.value,
    sourcePath,
    pagePath,
    pageUrl: new URL(pagePath, OG_SITE_URL).toString(),
    cacheKeyUrl: buildOgCacheKeyUrl(sourcePath, lang.value, url.origin),
  };
}

export function parseLemmaOgUrl(url: URL): LemmaOgRouteParseResult {
  const lang = parseOgLang(url);
  if (!lang.ok) return lang;

  const segments = pathnameSegments(url.pathname);
  if (segments.length !== 3 || segments[0] !== 'og' || segments[1] !== 'lemma') {
    return invalidOgRoute(404, 'invalid_path', 'Lemma OG path must be /og/lemma/{slug}.');
  }

  const slug = segments[2];
  if (!OG_SLUG_RE.test(slug)) {
    return invalidOgRoute(404, 'invalid_slug', `Invalid OG lemma slug: ${slug}.`);
  }

  const sourcePath = `/og/lemma/${slug}`;
  const pagePath = buildLemmaPagePath(slug, lang.value);

  return {
    ok: true,
    kind: 'lemma',
    slug,
    lang: lang.value,
    sourcePath,
    pagePath,
    pageUrl: new URL(pagePath, OG_SITE_URL).toString(),
    cacheKeyUrl: buildOgCacheKeyUrl(sourcePath, lang.value, url.origin),
  };
}

export async function fetchVerseOgPayload(
  db: CorpusDb,
  route: VerseOgRoute,
): Promise<VerseOgPayload | null> {
  interface VerseOgRow {
    title_en: string;
    title_sa: string;
    tradition: string;
    chapter: number;
    verse_num: number;
    devanagari: string;
    iast: string | null;
    requested_translation_text: string | null;
    requested_translation_translator: string | null;
    english_translation_text: string | null;
    english_translation_translator: string | null;
  }

  const row = await db.get<VerseOgRow>(
    `
      SELECT
        t.title_en,
        t.title_sa,
        t.tradition,
        v.chapter,
        v.verse_num,
        v.devanagari,
        v.iast,
        (
          SELECT tr.translation_text
          FROM translations tr
          WHERE tr.verse_id = v.id
            AND tr.lang = ?
            AND tr.status IN ${TRANSLATION_STATUS_SQL}
          ORDER BY tr.ai_assisted ASC, tr.status ASC, tr.created_at ASC
          LIMIT 1
        ) AS requested_translation_text,
        (
          SELECT tr.translator
          FROM translations tr
          WHERE tr.verse_id = v.id
            AND tr.lang = ?
            AND tr.status IN ${TRANSLATION_STATUS_SQL}
          ORDER BY tr.ai_assisted ASC, tr.status ASC, tr.created_at ASC
          LIMIT 1
        ) AS requested_translation_translator,
        (
          SELECT tr.translation_text
          FROM translations tr
          WHERE tr.verse_id = v.id
            AND tr.lang = 'en'
            AND tr.status IN ${TRANSLATION_STATUS_SQL}
          ORDER BY tr.ai_assisted ASC, tr.status ASC, tr.created_at ASC
          LIMIT 1
        ) AS english_translation_text,
        (
          SELECT tr.translator
          FROM translations tr
          WHERE tr.verse_id = v.id
            AND tr.lang = 'en'
            AND tr.status IN ${TRANSLATION_STATUS_SQL}
          ORDER BY tr.ai_assisted ASC, tr.status ASC, tr.created_at ASC
          LIMIT 1
        ) AS english_translation_translator
      FROM texts t
      JOIN verses v ON v.text_id = t.id
      WHERE t.tradition = ?
        AND t.slug = ?
        AND v.chapter = ?
        AND v.verse_num = ?
      LIMIT 1
    `,
    [route.lang, route.lang, route.tradition, route.textSlug, route.chapter, route.verse],
  );

  if (!row) return null;

  const requestedTranslation = row.requested_translation_text?.trim() || null;
  const englishTranslation = row.english_translation_text?.trim() || null;
  const translation = requestedTranslation ?? englishTranslation;
  const translationLang =
    requestedTranslation !== null ? route.lang : englishTranslation !== null ? OG_DEFAULT_LANG : null;
  const translator =
    requestedTranslation !== null
      ? row.requested_translation_translator
      : row.english_translation_translator;

  if (route.lang === OG_DEFAULT_LANG) {
    return {
      kind: 'verse',
      route,
      textTitleEn: row.title_en,
      textTitleSa: row.title_sa,
      tradition: row.tradition,
      citation: `${row.chapter}.${row.verse_num}`,
      devanagari: row.devanagari,
      iast: row.iast,
      translation,
      translationLang,
      translator,
      secondaryText: row.iast?.trim() || translation || row.devanagari,
      secondaryTextKind: row.iast?.trim() ? 'iast' : 'translation',
      secondaryTextLang: row.iast?.trim() ? OG_DEFAULT_LANG : translationLang ?? OG_DEFAULT_LANG,
      fallbackUsed: !row.iast?.trim() && translation !== null,
    };
  }

  return {
    kind: 'verse',
    route,
    textTitleEn: row.title_en,
    textTitleSa: row.title_sa,
    tradition: row.tradition,
    citation: `${row.chapter}.${row.verse_num}`,
    devanagari: row.devanagari,
    iast: row.iast,
    translation,
    translationLang,
    translator,
    secondaryText: translation || row.iast?.trim() || row.devanagari,
    secondaryTextKind: translation ? 'translation' : 'iast',
    secondaryTextLang: translationLang ?? OG_DEFAULT_LANG,
    fallbackUsed: translationLang !== route.lang,
  };
}

export async function fetchLemmaOgPayload(
  db: CorpusDb,
  route: LemmaOgRoute,
): Promise<LemmaOgPayload | null> {
  const lemma = await getLemmaIndexEntry(db, route.slug);
  if (!lemma || lemma.occurrenceCount < 3) return null;

  interface GlossRow {
    gloss_lang: string;
    gloss_text: string;
  }

  const glossRows = await db.all<GlossRow>(
    `
      SELECT g.gloss_lang, g.gloss_text
      FROM word_glosses g
      WHERE g.lemma_iast = ?
        AND g.gloss_lang IN (?, 'en')
      ORDER BY CASE WHEN g.gloss_lang = ? THEN 0 ELSE 1 END, g.verse_id ASC, g.word_idx ASC
      LIMIT 2
    `,
    [lemma.lemmaIast, route.lang, route.lang],
  );

  const requestedGloss = glossRows.find((row) => row.gloss_lang === route.lang)?.gloss_text?.trim() || null;
  const englishGloss = glossRows.find((row) => row.gloss_lang === 'en')?.gloss_text?.trim() || null;
  const gloss = requestedGloss ?? englishGloss;
  if (!gloss) return null;

  interface SampleVerseRow {
    tradition: string;
    text_slug: string;
    chapter: number;
    verse_num: number;
  }

  const sample = await db.get<SampleVerseRow>(
    `
      SELECT
        t.tradition,
        t.slug AS text_slug,
        v.chapter,
        v.verse_num
      FROM word_glosses g
      JOIN verses v ON v.id = g.verse_id
      JOIN texts t ON t.id = v.text_id
      WHERE g.lemma_iast = ?
      ORDER BY g.verse_id ASC, g.word_idx ASC
      LIMIT 1
    `,
    [lemma.lemmaIast],
  );

  if (!sample) return null;

  const samplePath = buildVersePagePath(
    sample.tradition as OgKnownTradition,
    sample.text_slug,
    sample.chapter,
    sample.verse_num,
    route.lang,
  );

  return {
    kind: 'lemma',
    route,
    slug: lemma.slug,
    lemmaIast: lemma.lemmaIast,
    lemmaSa: lemma.lemmaSa,
    gloss,
    glossLang: requestedGloss ? route.lang : OG_DEFAULT_LANG,
    occurrenceCount: lemma.occurrenceCount,
    samplePath,
    sampleUrl: new URL(samplePath, OG_SITE_URL).toString(),
    fallbackUsed: !requestedGloss,
  };
}

export function __resetLemmaIndexForTests(): void {
  _lemmaIndexPromise = null;
}

function invalidOgRoute(
  status: 400 | 404,
  code: OgRouteValidationError['code'],
  message: string,
): OgRouteValidationError {
  return { ok: false, status, code, message };
}

function parseOgLang(url: URL): { ok: true; value: LangCode } | OgRouteValidationError {
  const raw = url.searchParams.get('lang');
  if (raw === null || raw.length === 0) {
    return { ok: true, value: OG_DEFAULT_LANG };
  }
  if (!isOgLang(raw)) {
    return invalidOgRoute(400, 'invalid_lang', `Unsupported OG lang: ${raw}.`);
  }
  return { ok: true, value: raw };
}

function pathnameSegments(pathname: string): string[] {
  return pathname.split('/').filter(Boolean);
}

function parsePositiveIntSegment(raw: string): number | null {
  if (!OG_POSITIVE_INT_RE.test(raw)) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function buildVersePagePath(
  tradition: OgKnownTradition,
  textSlug: string,
  chapter: number,
  verse: number,
  lang: LangCode,
): string {
  const base = `/${tradition}/${textSlug}/${chapter}/${verse}`;
  return lang === OG_DEFAULT_LANG ? base : `/${lang}${base}`;
}

function buildLemmaPagePath(slug: string, lang: LangCode): string {
  const base = `/lemma/${slug}`;
  return lang === OG_DEFAULT_LANG ? base : `/${lang}${base}`;
}

async function getLemmaIndexEntry(
  db: CorpusDb,
  slug: string,
): Promise<LemmaIndexEntry | undefined> {
  if (_lemmaIndexPromise === null) {
    _lemmaIndexPromise = buildLemmaIndex(db);
  }
  const index = await _lemmaIndexPromise;
  return index.get(slug);
}

async function buildLemmaIndex(db: CorpusDb): Promise<Map<string, LemmaIndexEntry>> {
  const rows = await db.all<LemmaSeedRow>(
    `
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
    `,
  );

  const index = new Map<string, LemmaIndexEntry>();
  const seen = new Set<string>();
  for (const row of rows) {
    const slug = assignLemmaSlug(row.lemma_iast, seen);
    seen.add(slug);
    index.set(slug, {
      slug,
      lemmaIast: row.lemma_iast,
      lemmaSa: row.lemma_sa,
      occurrenceCount: row.occurrence_count,
      firstVerseId: row.first_verse_id,
    });
  }
  return index;
}
