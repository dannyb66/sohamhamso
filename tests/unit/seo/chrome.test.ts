import { describe, expect, it } from 'vitest';
import { buildChromeSeo } from '../../../src/lib/seo';

describe('buildChromeSeo', () => {
  it('suppresses hreflang when a chrome page is noindexed', () => {
    const seo = buildChromeSeo({
      availableLangs: ['en', 'hi'],
      basePath: '/search',
      description: 'Search the corpus.',
      lang: 'en',
      noindex: true,
      title: 'Search — sohamhamso',
    });

    expect(seo.noindex).toBe(true);
    expect(seo.hreflang).toEqual([]);
  });

  it('emits hreflang entries for indexable chrome pages', () => {
    const seo = buildChromeSeo({
      availableLangs: ['en'],
      basePath: '/dataset',
      description: 'Dataset downloads.',
      lang: 'en',
      title: 'Dataset — sohamhamso',
    });

    expect(seo.noindex).toBe(false);
    expect(seo.hreflang.map((entry) => entry.hreflang)).toEqual(['en', 'x-default']);
  });
});
