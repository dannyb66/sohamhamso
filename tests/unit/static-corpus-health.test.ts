import { beforeEach, describe, expect, it } from 'vitest';
import { runStaticCorpusHealthCheck } from '../../src/lib/static-corpus-health';
import { __resetStaticCorpusCacheForTests } from '../../src/lib/static-corpus-read';
import { __resetStaticSearchCacheForTests } from '../../src/lib/static-search';

function assets(): { fetch: (request: Request) => Promise<Response> } {
  const values = new Map<string, unknown>([
    [
      '/_data/corpus/manifest.json',
      {
        version: 1,
        texts: [
          { slug: 'siva-sutras', title_en: 'Siva Sutras', tradition: 'trika', chapters: [1] },
        ],
      },
    ],
    [
      '/_data/corpus/siva-sutras/1.json',
      {
        text: {
          id: 'siva-sutras',
          slug: 'siva-sutras',
          title_en: 'Siva Sutras',
          title_sa: null,
          tradition: 'trika',
        },
        chapter: 1,
        verses: [
          {
            id: 1,
            text_id: 'siva-sutras',
            chapter: 1,
            verse_num: 1,
            devanagari: 'चैतन्यमात्मा',
            iast: 'caitanyam atma',
          },
        ],
        translations: [
          {
            id: 1,
            verse_id: 1,
            lang: 'en',
            translation_text: 'Consciousness is the Self.',
            translator: 'test',
            status: 'published',
            ai_assisted: 0,
          },
        ],
        glosses: [],
        parallels: [],
      },
    ],
    [
      '/_data/corpus/search/en.json',
      {
        version: 1,
        lang: 'en',
        rows: [
          {
            verse_id: 1,
            text_id: 'siva-sutras',
            text_slug: 'siva-sutras',
            text_title: 'Siva Sutras',
            tradition: 'trika',
            chapter: 1,
            verse_num: 1,
            devanagari: 'चैतन्यमात्मा',
            iast: 'caitanyam atma',
            translation_excerpt: 'Consciousness is the Self.',
          },
        ],
      },
    ],
  ]);
  return {
    async fetch(request) {
      const value = values.get(new URL(request.url).pathname);
      return value
        ? new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
        : new Response('not found', { status: 404 });
    },
  };
}

beforeEach(() => {
  __resetStaticCorpusCacheForTests();
  __resetStaticSearchCacheForTests();
});

describe('static corpus health', () => {
  it('checks the deployed verse and search asset paths without a database', async () => {
    const report = await runStaticCorpusHealthCheck({
      assets: assets(),
      baseUrl: new URL('https://sohamhamso.org/api/health/corpus'),
      now: new Date('2026-09-16T00:00:00.000Z'),
    });

    expect(report.ok).toBe(true);
    expect(report.backend).toBe('static-assets');
    expect(report.checks.map((check) => [check.name, check.ok])).toEqual([
      ['corpus_read', true],
      ['search_read', true],
    ]);
  });
});
