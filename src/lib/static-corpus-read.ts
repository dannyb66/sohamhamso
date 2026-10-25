/** Read a generated chapter bundle without contacting a database. */

import type { LangCode } from './reading-modes';
import { SLUG_ALIASES } from './slug-aliases';
import type { VersePageBundle, VersePageRead } from './verse-read';

export type StaticAssets = { fetch: (request: Request) => Promise<Response> };
type Manifest = {
  version: 1;
  texts: Array<{
    slug: string;
    title_en: string;
    tradition: string;
    chapters: number[];
  }>;
};
type Bundle = {
  text: VersePageBundle['text'];
  chapter: number;
  verses: VersePageBundle['verse'][];
  translations: VersePageBundle['translations'];
  glosses: VersePageBundle['wordGlosses'];
  parallels: VersePageBundle['parallels'];
};
type LemmaIndex = {
  rows: Array<{
    lemma_iast: string;
    slug: string;
    occurrence_count: number;
    text_occurrences?: Record<string, number>;
  }>;
};

export class StaticCorpusUnavailableError extends Error {}

const cache = new Map<string, Promise<Bundle | null>>();
const manifestCache = new Map<string, Promise<Manifest | null>>();
const lemmaCache = new Map<string, Promise<LemmaIndex | null>>();

function cacheReadable<T>(
  values: Map<string, Promise<T | null>>,
  key: string,
  read: () => Promise<T | null>,
): Promise<T | null> {
  const cached = values.get(key);
  if (cached) return cached;
  const pending = read().then((value) => {
    if (value === null) values.delete(key);
    return value;
  });
  values.set(key, pending);
  return pending;
}

export async function readStaticCorpusJson<T>(
  path: string,
  options: { assets?: StaticAssets; baseUrl?: URL },
): Promise<T | null> {
  try {
    if (options.assets && options.baseUrl) {
      const compressed = await options.assets.fetch(
        new Request(new URL(`/_data/corpus/${path}.gz`, options.baseUrl)),
      );
      if (compressed.ok) {
        const stream = compressed.body?.pipeThrough(new DecompressionStream('gzip'));
        if (!stream) return null;
        return JSON.parse(await new Response(stream).text()) as T;
      }
      const response = await options.assets.fetch(
        new Request(new URL(`/_data/corpus/${path}`, options.baseUrl)),
      );
      return response.ok ? ((await response.json()) as T) : null;
    }

    const root = `${process.cwd()}/dist/_data/corpus`;
    const { readFile } = await import('node:fs/promises');
    try {
      const { gunzipSync } = await import('node:zlib');
      return JSON.parse(gunzipSync(await readFile(`${root}/${path}.gz`)).toString('utf8')) as T;
    } catch {
      return JSON.parse(await readFile(`${root}/${path}`, 'utf8')) as T;
    }
  } catch {
    return null;
  }
}

async function loadManifest(options: {
  assets?: StaticAssets;
  baseUrl?: URL;
}): Promise<Manifest | null> {
  const key = options.assets ? 'assets' : 'local';
  return cacheReadable(manifestCache, key, () =>
    readStaticCorpusJson<Manifest>('manifest.json', options),
  );
}

async function loadBundle(
  textSlug: string,
  chapter: number,
  assets?: StaticAssets,
  baseUrl?: URL,
): Promise<Bundle | null> {
  const key = `${assets ? 'assets' : 'local'}:${textSlug}:${chapter}`;
  return cacheReadable(cache, key, async () => {
    return readStaticCorpusJson<Bundle>(`${encodeURIComponent(textSlug)}/${chapter}.json`, {
      assets,
      baseUrl,
    });
  });
}

export async function readStaticVersePage(
  textSlug: string,
  chapter: number,
  verseNum: number,
  lang: LangCode,
  options: { assets?: StaticAssets; baseUrl?: URL } = {},
): Promise<VersePageRead | null> {
  const manifest = await loadManifest(options);
  if (!manifest) throw new StaticCorpusUnavailableError('Static corpus manifest is unavailable.');
  const canonicalSlug = SLUG_ALIASES[textSlug] ?? textSlug;
  const manifestText = manifest.texts.find((item) => item.slug === canonicalSlug);
  if (!manifestText) return { texts: manifest.texts, bundle: null };
  if (!manifestText.chapters.includes(chapter)) return { texts: manifest.texts, bundle: null };

  const bundle = await loadBundle(canonicalSlug, chapter, options.assets, options.baseUrl);
  if (!bundle) throw new StaticCorpusUnavailableError('Static corpus chapter is unavailable.');
  const verse = bundle.verses.find((item) => item.verse_num === verseNum);
  if (!verse) return { texts: manifest.texts, bundle: null };

  const allTranslations = bundle.translations
    .filter((item) => item.verse_id === verse.id)
    .map((item) => ({ ...item, ai_assisted: Boolean(item.ai_assisted) }));
  let translations = allTranslations.filter((item) => item.lang === lang);
  if (translations.length === 0)
    translations = allTranslations.filter((item) => item.lang === 'en');
  const allGlosses = bundle.glosses.filter((item) => item.verse_id === verse.id);
  const wordGlosses = allGlosses.filter((item) => item.gloss_lang === lang);
  const glossesByLang: VersePageBundle['glossesByLang'] = {};
  for (const item of allGlosses) {
    const langGlosses = glossesByLang[item.gloss_lang] ?? [];
    glossesByLang[item.gloss_lang] = langGlosses;
    langGlosses.push({
      word_idx: item.word_idx,
      word_sa: item.word_sa,
      lemma_iast: item.lemma_iast,
      gloss_text: item.gloss_text,
      morph: item.morph,
    });
  }
  const translationsByLang: VersePageBundle['translationsByLang'] = {};
  for (const item of allTranslations) {
    translationsByLang[item.lang] ??= {
      lang: item.lang,
      translation_text: item.translation_text,
      translator: item.translator,
      ai_assisted: item.ai_assisted,
    };
  }
  const position = bundle.verses.findIndex((item) => item.id === verse.id);
  let previous: VersePageBundle['verse'] | undefined = bundle.verses[position - 1];
  let previousChapter = chapter;
  let next: VersePageBundle['verse'] | undefined = bundle.verses[position + 1];
  let nextChapter = chapter;
  const chapterPosition = manifestText.chapters.indexOf(chapter);
  if (!previous && chapterPosition > 0) {
    previousChapter = manifestText.chapters[chapterPosition - 1];
    const previousBundle = await loadBundle(
      canonicalSlug,
      previousChapter,
      options.assets,
      options.baseUrl,
    );
    if (!previousBundle) throw new StaticCorpusUnavailableError('Previous chapter is unavailable.');
    previous = previousBundle.verses.at(-1);
  }
  if (!next && chapterPosition >= 0 && chapterPosition < manifestText.chapters.length - 1) {
    nextChapter = manifestText.chapters[chapterPosition + 1];
    const nextBundle = await loadBundle(
      canonicalSlug,
      nextChapter,
      options.assets,
      options.baseUrl,
    );
    if (!nextBundle) throw new StaticCorpusUnavailableError('Next chapter is unavailable.');
    next = nextBundle.verses[0];
  }
  const occurrenceCounts: VersePageBundle['occurrenceCounts'] = new Map();
  const lemmaSummaries: VersePageBundle['lemmaSummaries'] = new Map();
  if (allGlosses.some((item) => item.lemma_iast)) {
    const index = await cacheReadable(lemmaCache, options.assets ? 'assets' : 'local', () =>
      readStaticCorpusJson<LemmaIndex>('lemma-summaries.json', options),
    );
    if (!index) throw new StaticCorpusUnavailableError('Static lemma index is unavailable.');
    const lemmas = new Set(allGlosses.map((item) => item.lemma_iast));
    for (const item of index.rows) {
      if (!lemmas.has(item.lemma_iast)) continue;
      lemmaSummaries.set(item.lemma_iast, {
        slug: item.slug,
        occurrenceCount: item.occurrence_count,
      });
      occurrenceCounts.set(
        item.lemma_iast,
        Math.max(0, (item.text_occurrences?.[bundle.text.id] ?? 1) - 1),
      );
    }
  }
  return {
    texts: manifest.texts,
    bundle: {
      text: bundle.text,
      verse,
      translations,
      allTranslations,
      wordGlosses,
      glossesByLang,
      translationsByLang,
      parallels: bundle.parallels.filter((item) => item.source_verse_id === verse.id),
      prev: previous ? { chapter: previousChapter, verse_num: previous.verse_num } : null,
      next: next ? { chapter: nextChapter, verse_num: next.verse_num } : null,
      chapterVerseCount: bundle.verses.length,
      availability: [...new Set(['en', ...Object.keys(translationsByLang)])].sort(),
      occurrenceCounts,
      lemmaSummaries,
    },
  };
}

export function __resetStaticCorpusCacheForTests(): void {
  cache.clear();
  manifestCache.clear();
  lemmaCache.clear();
}
