import { describe, expect, it } from 'vitest';
import {
  buildHomeSeo,
  buildTextSeo,
  buildVerseSeo,
  inLanguageTag,
} from '../../../src/lib/seo';

const text = {
  id: 'test-text',
  slug: 'test-text',
  title_sa: 'परीक्षा',
  title_en: 'Test Text',
  title_iast: 'Pariksa',
  author: 'Test Author',
  tradition: 'trika',
  school: null,
  era: null,
  source: null,
  source_url: null,
  source_revision: null,
  license: 'CC-BY 4.0',
  attribution_html: null,
  parent_text_id: null,
  manuscript_url: null,
  description: null,
} as const;

const verse = {
  id: 1,
  text_id: 'test-text',
  book: null,
  chapter: 1,
  verse_num: 1,
  devanagari: 'चैतन्यमात्मा',
  slp1: null,
  iast: 'caitanyam ātmā',
  meter: null,
  manuscript_folio_ref: null,
} as const;

describe('inLanguageTag() helper', () => {
  it('returns bare "en" for English', () => {
    expect(inLanguageTag('en')).toBe('en');
  });

  it('returns "hi-IN" for Hindi', () => {
    expect(inLanguageTag('hi')).toBe('hi-IN');
  });

  it('returns "ta-IN" for Tamil', () => {
    expect(inLanguageTag('ta')).toBe('ta-IN');
  });

  it('disambiguates pa-IN (Gurmukhi) from pa-PK (Shahmukhi)', () => {
    expect(inLanguageTag('pa')).toBe('pa-IN');
  });

  it('disambiguates bn-IN from bn-BD', () => {
    expect(inLanguageTag('bn')).toBe('bn-IN');
  });

  it.each(['te', 'mr', 'gu', 'kn', 'ml', 'or', 'as'] as const)(
    'returns "%s-IN" for Indic locale %s',
    (lang) => {
      expect(inLanguageTag(lang)).toBe(`${lang}-IN`);
    },
  );
});

describe('JSON-LD integration — page-locale inLanguage routes through inLanguageTag', () => {
  it('Hindi verse: WebPage and Article carry "hi-IN"; Quotation stays "sa"', () => {
    const seo = buildVerseSeo({
      availableLangs: ['en', 'hi'],
      basePath: '/trika/test-text/1/1',
      lang: 'hi',
      text,
      translation: 'चैतन्य ही आत्मा है।',
      verse,
    });
    const byType = Object.fromEntries(
      seo.jsonLd.map((n) => [n['@type'] as string, n]),
    );
    expect(byType.WebPage?.inLanguage).toBe('hi-IN');
    expect(byType.Article?.inLanguage).toBe('hi-IN');
    expect(byType.Quotation?.inLanguage).toBe('sa');
  });

  it('English verse: page nodes carry bare "en"; Quotation stays "sa"', () => {
    const seo = buildVerseSeo({
      availableLangs: ['en'],
      basePath: '/trika/test-text/1/1',
      lang: 'en',
      text,
      translation: 'Consciousness is the Self.',
      verse,
    });
    const byType = Object.fromEntries(
      seo.jsonLd.map((n) => [n['@type'] as string, n]),
    );
    expect(byType.WebPage?.inLanguage).toBe('en');
    expect(byType.Article?.inLanguage).toBe('en');
    expect(byType.Quotation?.inLanguage).toBe('sa');
  });

  it('Tamil home page: WebPage carries "ta-IN"; WebSite array stays bare codes', () => {
    const seo = buildHomeSeo({
      availableLangs: ['en', 'ta'],
      lang: 'ta',
    });
    const byType = Object.fromEntries(
      seo.jsonLd.map((n) => [n['@type'] as string, n]),
    );
    expect(byType.WebPage?.inLanguage).toBe('ta-IN');
    expect(Array.isArray(byType.WebSite?.inLanguage)).toBe(true);
    // WebSite is a site-wide availability list; intentionally bare codes
    expect(byType.WebSite?.inLanguage).toEqual([
      'en',
      'hi',
      'ta',
      'te',
      'bn',
      'mr',
      'gu',
      'kn',
      'ml',
      'pa',
      'or',
      'as',
    ]);
  });

  it('Hindi text page: Book inLanguage stays "sa" (source-language, not page locale)', () => {
    const seo = buildTextSeo({
      availableLangs: ['en', 'hi'],
      basePath: '/trika/test-text',
      lang: 'hi',
      text,
      totalVerses: 12,
    });
    const byType = Object.fromEntries(
      seo.jsonLd.map((n) => [n['@type'] as string, n]),
    );
    expect(byType.WebPage?.inLanguage).toBe('hi-IN');
    expect(byType.Book?.inLanguage).toBe('sa');
  });
});
