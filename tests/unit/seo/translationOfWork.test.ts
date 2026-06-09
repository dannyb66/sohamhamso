import { describe, expect, it } from 'vitest';
import { buildVerseSeo } from '../../../src/lib/seo';

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

describe('verse SEO translationOfWork', () => {
  it('omits translationOfWork on the canonical English verse Article', () => {
    const seo = buildVerseSeo({
      availableLangs: ['en'],
      basePath: '/trika/test-text/1/1',
      lang: 'en',
      text,
      translation: 'Consciousness is the Self.',
      verse,
    });
    const article = seo.jsonLd.find((node) => node['@type'] === 'Article');
    expect(article).toBeTruthy();
    expect(article?.translationOfWork).toBeUndefined();
  });

  it('points the Hindi verse Article back to the EN canonical', () => {
    const seo = buildVerseSeo({
      availableLangs: ['en', 'hi'],
      basePath: '/trika/test-text/1/1',
      lang: 'hi',
      text,
      translation: 'चैतन्य ही आत्मा है।',
      verse,
    });
    const article = seo.jsonLd.find((node) => node['@type'] === 'Article');
    expect(article?.translationOfWork).toBe('https://sohamhamso.org/trika/test-text/1/1');
  });

  it('points the Tamil verse Article back to the EN canonical', () => {
    const seo = buildVerseSeo({
      availableLangs: ['en', 'ta'],
      basePath: '/trika/test-text/1/1',
      lang: 'ta',
      text,
      translation: 'உணர்வே ஆத்மா.',
      verse,
    });
    const article = seo.jsonLd.find((node) => node['@type'] === 'Article');
    expect(article?.translationOfWork).toBe('https://sohamhamso.org/trika/test-text/1/1');
  });

  it('does not attach translationOfWork to the Quotation node (Sanskrit is the source)', () => {
    const seo = buildVerseSeo({
      availableLangs: ['en', 'hi'],
      basePath: '/trika/test-text/1/1',
      lang: 'hi',
      text,
      translation: 'चैतन्य ही आत्मा है।',
      verse,
    });
    const quotation = seo.jsonLd.find((node) => node['@type'] === 'Quotation');
    expect(quotation).toBeTruthy();
    expect(quotation?.translationOfWork).toBeUndefined();
    expect(quotation?.inLanguage).toBe('sa');
  });
});
