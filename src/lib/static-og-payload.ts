import type { LangCode } from './reading-modes';
import type { LemmaOgPayload, LemmaOgRoute, VerseOgPayload, VerseOgRoute } from './seo/og-payload';
import { OG_DEFAULT_LANG, OG_SITE_URL } from './seo/og-payload';
import { type StaticAssets, readStaticCorpusJson, readStaticVersePage } from './static-corpus-read';

type Options = { assets: StaticAssets; baseUrl: URL };
type LemmaIndex = {
  version: 1;
  rows: Array<{
    slug: string;
    lemma_iast: string;
    lemma_sa: string | null;
    occurrence_count: number;
    glosses: Record<string, string>;
    sample: { tradition: string; text_slug: string; chapter: number; verse_num: number };
  }>;
};

export async function readStaticVerseOgPayload(
  route: VerseOgRoute,
  options: Options,
): Promise<VerseOgPayload | null> {
  const result = await readStaticVersePage(
    route.textSlug,
    route.chapter,
    route.verse,
    route.lang,
    options,
  );
  const bundle = result?.bundle;
  if (!bundle || bundle.text.tradition !== route.tradition) return null;

  const requested = bundle.allTranslations.find((item) => item.lang === route.lang);
  const english = bundle.allTranslations.find((item) => item.lang === OG_DEFAULT_LANG);
  const selected = requested ?? english;
  const translation = selected?.translation_text?.trim() || null;
  const translationLang = (selected?.lang as LangCode | undefined) ?? null;
  const iast = bundle.verse.iast?.trim() || null;
  const localized = route.lang !== OG_DEFAULT_LANG;

  return {
    kind: 'verse',
    route,
    textTitleEn: bundle.text.title_en,
    textTitleSa: bundle.text.title_sa,
    tradition: bundle.text.tradition,
    citation: `${bundle.verse.chapter}.${bundle.verse.verse_num}`,
    devanagari: bundle.verse.devanagari,
    iast,
    translation,
    translationLang,
    translator: selected?.translator ?? null,
    secondaryText: localized
      ? translation || iast || bundle.verse.devanagari
      : iast || translation || bundle.verse.devanagari,
    secondaryTextKind: localized && translation ? 'translation' : iast ? 'iast' : 'translation',
    secondaryTextLang:
      localized && translation ? (translationLang ?? OG_DEFAULT_LANG) : OG_DEFAULT_LANG,
    fallbackUsed: localized ? translationLang !== route.lang : !iast && translation !== null,
  };
}

export async function readStaticLemmaOgPayload(
  route: LemmaOgRoute,
  options: Options,
): Promise<LemmaOgPayload | null> {
  const index = await readStaticCorpusJson<LemmaIndex>('lemmas.json', options);
  const lemma = index?.rows.find((item) => item.slug === route.slug);
  if (!lemma?.sample || lemma.occurrence_count < 3) return null;
  const requestedGloss = lemma.glosses[route.lang]?.trim() || null;
  const englishGloss = lemma.glosses[OG_DEFAULT_LANG]?.trim() || null;
  const gloss = requestedGloss ?? englishGloss;
  if (!gloss) return null;
  const base = `/${lemma.sample.tradition}/${lemma.sample.text_slug}/${lemma.sample.chapter}/${lemma.sample.verse_num}`;
  const samplePath = route.lang === OG_DEFAULT_LANG ? base : `/${route.lang}${base}`;
  return {
    kind: 'lemma',
    route,
    slug: lemma.slug,
    lemmaIast: lemma.lemma_iast,
    lemmaSa: lemma.lemma_sa,
    gloss,
    glossLang: requestedGloss ? route.lang : OG_DEFAULT_LANG,
    occurrenceCount: lemma.occurrence_count,
    samplePath,
    sampleUrl: new URL(samplePath, OG_SITE_URL).toString(),
    fallbackUsed: !requestedGloss,
  };
}
