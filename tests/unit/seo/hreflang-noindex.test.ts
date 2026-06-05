import { describe, expect, it } from 'vitest';
import { buildVerseSeo } from '../../../src/lib/seo';

describe('buildVerseSeo noindex + hreflang invariant', () => {
  const text = {
    id: 'siva-sutras',
    slug: 'siva-sutras',
    title_sa: 'शिवसूत्राणि',
    title_en: 'Śiva Sūtras',
    title_iast: 'Śivasūtrāṇi',
    author: 'Vasugupta',
    tradition: 'trika',
    school: 'kashmir-shaivism',
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
    text_id: 'siva-sutras',
    book: null,
    chapter: 1,
    verse_num: 1,
    devanagari: 'चैतन्यमात्मा ॥१॥',
    slp1: null,
    iast: 'caitanyam ātmā',
    meter: 'sūtra',
    manuscript_folio_ref: null,
  } as const;

  it('suppresses hreflang when the current page is noindexed', () => {
    const seo = buildVerseSeo({
      availableLangs: ['en', 'hi'],
      basePath: '/trika/siva-sutras/1/1',
      lang: 'ta',
      text,
      translation: null,
      verse,
    });

    expect(seo.noindex).toBe(true);
    expect(seo.hreflang).toEqual([]);
  });

  it('emits reciprocal-looking hreflang entries for indexable pages', () => {
    const seo = buildVerseSeo({
      availableLangs: ['en', 'hi'],
      basePath: '/trika/siva-sutras/1/1',
      lang: 'hi',
      text,
      translation: 'चैतन्य ही आत्मा है।',
      verse,
    });

    expect(seo.noindex).toBe(false);
    expect(seo.hreflang.map((entry) => entry.hreflang)).toEqual(['en', 'hi', 'x-default']);
  });
});
