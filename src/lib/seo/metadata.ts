import type { Text, TextSummary, Verse } from '../db';
import type { LangCode } from '../reading-modes';
import { filterIndexableTextLangs, getTextSeoOverrides } from './corpus-overrides';
import { resolveTextDescription, resolveVerseDescription } from './descriptions';
import { type HreflangEntry, buildHreflangEntries } from './hreflang';
import { absoluteLocaleUrl, inLanguageTag } from './i18n-routes';
import {
  type JsonLdNode,
  buildArticleJsonLd,
  buildBookJsonLd,
  buildBreadcrumbList,
  buildDefinedTermJsonLd,
  buildFaqPageJsonLd,
  buildOrganizationJsonLd,
  buildQuotationJsonLd,
  buildWebPageJsonLd,
  buildWebSiteJsonLd,
  combineJsonLd,
} from './jsonld';
import { resolveTextKeywords } from './keywords';

export interface PageSeo {
  canonical: string;
  description: string;
  hreflang: HreflangEntry[];
  jsonLd: JsonLdNode[];
  keywords: string[];
  noindex: boolean;
  ogImageUrl?: string;
  title: string;
}

function truncate(text: string, max = 160): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1).trimEnd()}…`;
}

function titlePrefix(lang: LangCode): string {
  return lang === 'en' ? '' : `${lang.toUpperCase()} · `;
}

export function buildVerseSeo(input: {
  availableLangs: LangCode[];
  basePath: string;
  indexable?: boolean;
  lang: LangCode;
  text: Text;
  translation: string | null;
  verse: Verse;
}): PageSeo {
  const allowedLangs = filterIndexableTextLangs(input.text.slug, input.availableLangs);
  const corpusSeo = getTextSeoOverrides(input.text.slug, input.lang);
  const locator = `${input.verse.chapter}.${input.verse.verse_num}`;
  const title = `${titlePrefix(input.lang)}${input.text.title_en} ${locator} — sohamhamso`;
  const resolved = resolveVerseDescription({
    lang: input.lang,
    text: input.text,
    chapter: input.verse.chapter,
    verseNum: input.verse.verse_num,
    translation: input.translation,
  });
  const description = truncate(
    resolved ??
      `${input.text.title_en} ${locator} — Sanskrit verse anatomy with translation and word-by-word glosses.`,
  );
  const canonical = absoluteLocaleUrl(input.basePath, input.lang);
  const noindex =
    input.indexable === false || corpusSeo.noindex || resolved === null || !input.translation;
  const hreflang = noindex ? [] : buildHreflangEntries(input.basePath, allowedLangs);
  const breadcrumbs = buildBreadcrumbList([
    { name: 'Home', item: absoluteLocaleUrl('/', input.lang) },
    { name: input.text.tradition, item: absoluteLocaleUrl(`/${input.text.tradition}`, input.lang) },
    {
      name: input.text.title_en,
      item: absoluteLocaleUrl(`/${input.text.tradition}/${input.text.slug}`, input.lang),
    },
    { name: locator, item: canonical },
  ]);
  return {
    canonical,
    description,
    hreflang,
    jsonLd: combineJsonLd(
      buildWebPageJsonLd({
        title,
        description,
        url: canonical,
        inLanguage: inLanguageTag(input.lang),
      }),
      buildArticleJsonLd({
        title,
        description,
        url: canonical,
        inLanguage: inLanguageTag(input.lang),
        isPartOf: absoluteLocaleUrl(`/${input.text.tradition}/${input.text.slug}`, input.lang),
        translationOfWork:
          input.lang === 'en' ? undefined : absoluteLocaleUrl(input.basePath, 'en'),
      }),
      buildQuotationJsonLd({
        verse: {
          devanagari: input.verse.devanagari,
          iast: input.verse.iast,
          chapter: input.verse.chapter,
          verse_num: input.verse.verse_num,
        },
        text: {
          slug: input.text.slug,
          title_en: input.text.title_en,
          tradition: input.text.tradition,
        },
      }),
      breadcrumbs,
    ),
    keywords: [],
    noindex,
    ogImageUrl: absoluteLocaleUrl(
      `/og/${input.text.tradition}/${input.text.slug}/${input.verse.chapter}/${input.verse.verse_num}?lang=${input.lang}`,
      'en',
    ),
    title,
  };
}

export function buildTextSeo(input: {
  availableLangs: LangCode[];
  basePath: string;
  indexable?: boolean;
  lang: LangCode;
  text: Text;
  totalVerses: number;
}): PageSeo {
  const allowedLangs = filterIndexableTextLangs(input.text.slug, input.availableLangs);
  const corpusSeo = getTextSeoOverrides(input.text.slug, input.lang);
  const title = `${titlePrefix(input.lang)}${input.text.title_en} — sohamhamso`;
  const description = truncate(
    resolveTextDescription({
      lang: input.lang,
      text: input.text,
      totalVerses: input.totalVerses,
    }),
  );
  const canonical = absoluteLocaleUrl(input.basePath, input.lang);
  const noindex = input.indexable === false || corpusSeo.noindex;
  const keywords = resolveTextKeywords({
    lang: input.lang,
    text: input.text,
  });
  return {
    canonical,
    description,
    hreflang: noindex ? [] : buildHreflangEntries(input.basePath, allowedLangs),
    jsonLd: combineJsonLd(
      buildWebPageJsonLd({
        title,
        description,
        url: canonical,
        inLanguage: inLanguageTag(input.lang),
      }),
      buildBookJsonLd({
        text: {
          slug: input.text.slug,
          title_en: input.text.title_en,
          title_sa: input.text.title_sa,
          title_iast: input.text.title_iast,
          author: input.text.author,
          tradition: input.text.tradition,
          license: input.text.license,
        },
      }),
      buildFaqPageJsonLd({
        faqs: corpusSeo.faqEntries,
        inLanguage: inLanguageTag(input.lang),
        url: canonical,
      }),
      buildBreadcrumbList([
        { name: 'Home', item: absoluteLocaleUrl('/', input.lang) },
        {
          name: input.text.tradition,
          item: absoluteLocaleUrl(`/${input.text.tradition}`, input.lang),
        },
        { name: input.text.title_en, item: canonical },
      ]),
    ),
    keywords,
    noindex,
    title,
  };
}

export function buildTraditionSeo(input: {
  availableLangs: LangCode[];
  basePath: string;
  indexable?: boolean;
  lang: LangCode;
  tradition: string;
  textCount: number;
  totalVerses: number;
}): PageSeo {
  const traditionLabel = input.tradition.charAt(0).toUpperCase() + input.tradition.slice(1);
  const title = `${titlePrefix(input.lang)}${traditionLabel} — sohamhamso`;
  const description = `${input.textCount} texts in the ${traditionLabel} tradition, ${input.totalVerses} verses.`;
  const canonical = absoluteLocaleUrl(input.basePath, input.lang);
  const noindex = input.indexable === false;
  return {
    canonical,
    description,
    hreflang: noindex ? [] : buildHreflangEntries(input.basePath, input.availableLangs),
    jsonLd: combineJsonLd(
      buildWebPageJsonLd({
        title,
        description,
        url: canonical,
        inLanguage: inLanguageTag(input.lang),
      }),
    ),
    keywords: [],
    noindex,
    title,
  };
}

export function buildHomeSeo(input: {
  availableLangs: LangCode[];
  indexable?: boolean;
  lang: LangCode;
}): PageSeo {
  const title = `${titlePrefix(input.lang)}sohamhamso — The Tantric canon, read in eleven tongues`;
  const description =
    'A modern reader for the Tantric, Kashmir Shaivism, Trika, and Kaula Sanskrit canon. Translations in eleven Indian languages.';
  const canonical = absoluteLocaleUrl('/', input.lang);
  const noindex = input.indexable === false;
  return {
    canonical,
    description,
    hreflang: noindex ? [] : buildHreflangEntries('/', input.availableLangs),
    jsonLd: combineJsonLd(
      buildWebPageJsonLd({
        title,
        description,
        url: canonical,
        inLanguage: inLanguageTag(input.lang),
      }),
      buildWebSiteJsonLd(),
      buildOrganizationJsonLd(),
    ),
    keywords: [],
    noindex,
    title,
  };
}

export function buildChromeSeo(input: {
  availableLangs?: LangCode[];
  basePath: string;
  description: string;
  indexable?: boolean;
  lang: LangCode;
  title: string;
  noindex?: boolean;
}): PageSeo {
  const canonical = absoluteLocaleUrl(input.basePath, input.lang);
  const noindex = input.indexable === false || !!input.noindex;
  return {
    canonical,
    description: truncate(input.description),
    hreflang: noindex
      ? []
      : buildHreflangEntries(input.basePath, input.availableLangs ?? [input.lang]),
    jsonLd: combineJsonLd(
      buildWebPageJsonLd({
        title: input.title,
        description: truncate(input.description),
        url: canonical,
        inLanguage: inLanguageTag(input.lang),
      }),
    ),
    keywords: [],
    noindex,
    title: input.title,
  };
}

export function buildLemmaSeo(input: {
  availableLangs: LangCode[];
  basePath: string;
  gloss: string;
  indexable?: boolean;
  lang: LangCode;
  lemmaIast: string;
  lemmaSa?: string | null;
  occurrenceCount: number;
  samplePath: string;
}): PageSeo {
  const title = `${titlePrefix(input.lang)}${input.lemmaIast} meaning — sohamhamso`;
  const description = truncate(
    `${input.lemmaIast}${input.lemmaSa ? ` (${input.lemmaSa})` : ''} meaning and usage across ${input.occurrenceCount} verses in the Tantric corpus.`,
  );
  const canonical = absoluteLocaleUrl(input.basePath, input.lang);
  const noindex = input.indexable === false;
  return {
    canonical,
    description,
    hreflang: noindex ? [] : buildHreflangEntries(input.basePath, input.availableLangs),
    jsonLd: combineJsonLd(
      buildWebPageJsonLd({
        title,
        description,
        url: canonical,
        inLanguage: inLanguageTag(input.lang),
      }),
      buildArticleJsonLd({
        title,
        description,
        url: canonical,
        inLanguage: inLanguageTag(input.lang),
        isPartOf: absoluteLocaleUrl('/', input.lang),
      }),
      buildDefinedTermJsonLd({
        alternateName: input.lemmaSa,
        description: input.gloss,
        inLanguage: inLanguageTag(input.lang),
        name: input.lemmaIast,
        termCode: input.lemmaIast,
        url: canonical,
      }),
      buildBreadcrumbList([
        { name: 'Home', item: absoluteLocaleUrl('/', input.lang) },
        { name: input.lemmaIast, item: canonical },
      ]),
    ),
    keywords: [],
    noindex,
    ogImageUrl: absoluteLocaleUrl(
      `/og/lemma/${input.basePath.split('/').at(-1)}?lang=${input.lang}`,
      'en',
    ),
    title,
  };
}

export function availableLangsFromRecord(
  translationsByLang: Record<string, unknown>,
  fallback: LangCode = 'en',
): LangCode[] {
  const langs = Object.keys(translationsByLang).filter((lang): lang is LangCode => !!lang);
  if (!langs.includes(fallback)) langs.unshift(fallback);
  return langs;
}

export function traditionAvailableLangs(): LangCode[] {
  return ['en', 'hi', 'ta', 'te', 'bn', 'mr', 'gu', 'kn', 'ml', 'pa', 'or', 'as'];
}

export function summarizeTradition(input: {
  texts: TextSummary[];
  tradition: string;
}): { textCount: number; totalVerses: number } {
  const texts = input.texts.filter((text) => text.tradition === input.tradition);
  return {
    textCount: texts.length,
    totalVerses: texts.reduce((sum, text) => sum + (text.verse_count ?? 0), 0),
  };
}
