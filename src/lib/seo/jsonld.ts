import { SITE_URL } from './i18n-routes';

export type JsonLdNode = Record<string, unknown>;

export function combineJsonLd(...nodes: Array<JsonLdNode | null | undefined>): JsonLdNode[] {
  return nodes.filter((node): node is JsonLdNode => !!node);
}

export function buildBreadcrumbList(
  items: Array<{ name: string; item: string }>,
): JsonLdNode | null {
  if (items.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((entry, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: entry.name,
      item: entry.item,
    })),
  };
}

export function buildWebPageJsonLd(input: {
  title: string;
  description: string;
  url: string;
  inLanguage: string;
}): JsonLdNode {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: input.title,
    description: input.description,
    url: input.url,
    inLanguage: input.inLanguage,
  };
}

export function buildArticleJsonLd(input: {
  title: string;
  description: string;
  url: string;
  inLanguage: string;
  isPartOf?: string;
  translationOfWork?: string;
  ogImageUrl?: string;
  textSourceRevision?: string;
}): JsonLdNode {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: input.title,
    description: input.description,
    url: input.url,
    inLanguage: input.inLanguage,
    isPartOf: input.isPartOf,
    translationOfWork: input.translationOfWork,
    author: { '@type': 'Organization' as const, name: 'sohamhamso', url: SITE_URL },
    datePublished: input.textSourceRevision ?? '2026-06-01',
    dateModified: input.textSourceRevision ?? '2026-06-01',
    image: input.ogImageUrl,
  };
}

export function buildFaqPageJsonLd(input: {
  faqs: Array<{ answer: string; question: string }>;
  inLanguage: string;
  url: string;
}): JsonLdNode | null {
  if (input.faqs.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    inLanguage: input.inLanguage,
    mainEntity: input.faqs.map((entry) => ({
      '@type': 'Question',
      acceptedAnswer: {
        '@type': 'Answer',
        text: entry.answer,
      },
      name: entry.question,
    })),
    url: input.url,
  };
}

export function buildDefinedTermJsonLd(input: {
  alternateName?: string | null;
  description: string;
  inLanguage: string;
  name: string;
  termCode?: string | null;
  url: string;
}): JsonLdNode {
  return {
    '@context': 'https://schema.org',
    '@type': 'DefinedTerm',
    alternateName: input.alternateName ?? undefined,
    description: input.description,
    inDefinedTermSet: 'https://sohamhamso.org/lemma',
    inLanguage: input.inLanguage,
    name: input.name,
    termCode: input.termCode ?? undefined,
    url: input.url,
  };
}

export function buildBookJsonLd(input: {
  text: {
    slug: string;
    title_en: string;
    title_sa?: string | null;
    title_iast?: string | null;
    author?: string | null;
    tradition: string;
    license?: string | null;
  };
}): JsonLdNode {
  const { text } = input;
  const alternateNames = [text.title_sa, text.title_iast].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  return {
    '@context': 'https://schema.org',
    '@type': 'Book',
    '@id': `${SITE_URL}/${text.tradition}/${text.slug}`,
    name: text.title_en,
    alternateName: alternateNames.length > 0 ? alternateNames : undefined,
    author: text.author ? { '@type': 'Person', name: text.author } : undefined,
    inLanguage: 'sa',
    bookFormat: 'EBook',
    isAccessibleForFree: true,
    license: text.license ?? 'https://creativecommons.org/licenses/by-sa/4.0/',
    publisher: { '@type': 'Organization', name: 'sohamhamso', url: SITE_URL },
  };
}

export function buildQuotationJsonLd(input: {
  verse: {
    devanagari?: string | null;
    iast?: string | null;
    chapter: number;
    verse_num: number;
  };
  text: { slug: string; title_en: string; tradition: string };
  speaker?: string;
}): JsonLdNode {
  const { verse, text } = input;
  return {
    '@context': 'https://schema.org',
    '@type': 'Quotation',
    text: verse.devanagari ?? verse.iast ?? undefined,
    alternativeHeadline: verse.iast ?? undefined,
    inLanguage: 'sa',
    citation: `${text.title_en} ${verse.chapter}.${verse.verse_num}`,
    isPartOf: {
      '@type': 'Book',
      name: text.title_en,
      '@id': `${SITE_URL}/${text.tradition}/${text.slug}`,
    },
    ...(input.speaker
      ? {
          spokenByCharacter: { '@type': 'Person' as const, name: input.speaker },
        }
      : {}),
  };
}

export function buildWebSiteJsonLd(): JsonLdNode {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    url: SITE_URL,
    name: 'sohamhamso',
    description: 'The Tantric canon, read in eleven tongues.',
    inLanguage: ['en', 'hi', 'ta', 'te', 'bn', 'mr', 'gu', 'kn', 'ml', 'pa', 'or', 'as'],
    publisher: { '@id': `${SITE_URL}/#organization` },
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE_URL}/search?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

export function buildOrganizationJsonLd(): JsonLdNode {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    name: 'sohamhamso',
    url: SITE_URL,
    description:
      'Modern reader for the Tantric, Kashmir Shaivism, Trika, and Kaula Sanskrit canon.',
    foundingDate: '2026',
    logo: { '@type': 'ImageObject' as const, url: `${SITE_URL}/apple-touch-icon.png` },
  };
}
