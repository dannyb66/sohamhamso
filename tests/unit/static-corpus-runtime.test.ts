import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetStaticCorpusCacheForTests,
  readStaticVersePage,
} from '../../src/lib/static-corpus-read';
import { __resetStaticSearchCacheForTests } from '../../src/lib/static-search';
import { GET as dailyCorpus } from '../../src/pages/api/corpus/daily';
import { GET as search } from '../../src/pages/api/search';

const text = {
  id: 'siva-sutras',
  slug: 'siva-sutras',
  title_en: 'Śiva Sūtras',
  title_sa: 'शिवसूत्र',
  tradition: 'trika',
};

const verse = (id: number, chapter: number, verse_num: number) => ({
  id,
  text_id: 'siva-sutras',
  chapter,
  verse_num,
  devanagari: `verse ${chapter}.${verse_num}`,
  iast: `verse ${chapter}.${verse_num}`,
});

function assets(): { fetch: (request: Request) => Promise<Response> } {
  const values = new Map<string, unknown>([
    [
      '/_data/corpus/manifest.json',
      {
        version: 1,
        texts: [
          {
            slug: 'siva-sutras',
            title_en: 'Śiva Sūtras',
            tradition: 'trika',
            chapters: [1, 2],
          },
        ],
      },
    ],
    [
      '/_data/corpus/siva-sutras/1.json',
      {
        version: 1,
        text,
        chapter: 1,
        verses: [verse(1, 1, 1), verse(2, 1, 2)],
        translations: [],
        glosses: [
          {
            verse_id: 1,
            word_idx: 0,
            word_sa: 'चैतन्यम्',
            lemma_iast: 'caitanya',
            lemma_sa: 'चैतन्य',
            gloss_lang: 'en',
            gloss_text: 'consciousness',
            morph: null,
          },
        ],
        parallels: [],
      },
    ],
    [
      '/_data/corpus/siva-sutras/2.json',
      {
        version: 1,
        text,
        chapter: 2,
        verses: [verse(3, 2, 1), verse(4, 2, 2)],
        translations: [],
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
            text_title: 'Śiva Sūtras',
            tradition: 'trika',
            chapter: 1,
            verse_num: 1,
            devanagari: 'चैतन्यमात्मा',
            iast: 'caitanyam ātmā',
            translation_excerpt: 'Consciousness is the Self.',
            search_text: `Consciousness is the Self. ${'a'.repeat(250)} lateword`,
          },
        ],
      },
    ],
    [
      '/_data/corpus/lemma-summaries.json',
      {
        version: 1,
        rows: [
          {
            slug: 'caitanya',
            lemma_iast: 'caitanya',
            occurrence_count: 7,
            text_occurrences: { 'siva-sutras': 3 },
          },
        ],
      },
    ],
  ]);
  return {
    async fetch(request) {
      const value = values.get(new URL(request.url).pathname);
      return value
        ? new Response(JSON.stringify(value), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        : new Response('not found', { status: 404 });
    },
  };
}

beforeEach(() => {
  __resetStaticCorpusCacheForTests();
  __resetStaticSearchCacheForTests();
});

describe('static corpus runtime', () => {
  it('recovers from an unavailable manifest without resetting the cache', async () => {
    const healthyAssets = assets();
    let available = false;
    const transientAssets = {
      fetch: async (request: Request) =>
        available
          ? healthyAssets.fetch(request)
          : new Response('temporarily unavailable', { status: 503 }),
    };
    const options = {
      assets: transientAssets,
      baseUrl: new URL('https://sohamhamso.org/trika/siva-sutras/1/1'),
    };
    await expect(readStaticVersePage('siva-sutras', 1, 1, 'en', options)).rejects.toThrow();

    available = true;
    const recovered = await readStaticVersePage('siva-sutras', 1, 1, 'en', options);
    expect(recovered?.bundle?.verse.id).toBe(1);
  });

  it('distinguishes a nonexistent chapter from unavailable static content', async () => {
    const read = await readStaticVersePage('siva-sutras', 999, 1, 'en', {
      assets: assets(),
      baseUrl: new URL('https://sohamhamso.org/trika/siva-sutras/999/1'),
    });

    expect(read).toEqual({ texts: expect.any(Array), bundle: null });
  });

  it('hydrates lemma links and other-verse occurrence counts from the static index', async () => {
    const read = await readStaticVersePage('siva-sutras', 1, 1, 'en', {
      assets: assets(),
      baseUrl: new URL('https://sohamhamso.org/trika/siva-sutras/1/1'),
    });

    expect(read?.bundle?.lemmaSummaries.get('caitanya')).toEqual({
      slug: 'caitanya',
      occurrenceCount: 7,
    });
    expect(read?.bundle?.occurrenceCounts.get('caitanya')).toBe(2);
    expect(read?.bundle?.wordGlosses[0].gloss_text).toBe('consciousness');
  });

  it('searches full translations beyond the response excerpt', async () => {
    const response = await search({
      url: new URL('https://sohamhamso.org/api/search?q=lateword&lang=en'),
      locals: { runtime: { env: { ASSETS: assets() } } },
    } as unknown as Parameters<typeof search>[0]);
    const body = (await response.json()) as { data: Array<{ translation_excerpt: string }> };

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].translation_excerpt).toBe('Consciousness is the Self.');
    expect(body.data[0]).not.toHaveProperty('search_text');
  });

  it('resolves aliases and navigates across chapter boundaries', async () => {
    const read = await readStaticVersePage('shiva-sutras', 2, 1, 'en', {
      assets: assets(),
      baseUrl: new URL('https://sohamhamso.org/trika/shiva-sutras/2/1'),
    });

    expect(read?.bundle?.text.slug).toBe('siva-sutras');
    expect(read?.bundle?.prev).toEqual({ chapter: 1, verse_num: 2 });
    expect(read?.bundle?.next).toEqual({ chapter: 2, verse_num: 2 });
    expect(read?.texts).toEqual([
      expect.objectContaining({ slug: 'siva-sutras', tradition: 'trika' }),
    ]);
  });

  it('serves semantic requests from the static lexical index', async () => {
    const response = await search({
      url: new URL('https://sohamhamso.org/api/search?q=caitanyam&type=semantic&lang=en'),
      locals: { runtime: { env: { ASSETS: assets() } } },
    } as unknown as Parameters<typeof search>[0]);
    const body = (await response.json()) as {
      data: unknown[];
      meta: { type: string; note: string };
    };

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.meta).toEqual(
      expect.objectContaining({ type: 'lexical', note: 'static-index-semantic-fallback' }),
    );
  });

  it('serves the daily Worker corpus through a public API route', async () => {
    const response = await dailyCorpus({
      url: new URL('https://sohamhamso.org/api/corpus/daily'),
      locals: { runtime: { env: { ASSETS: assets() } } },
    } as unknown as Parameters<typeof dailyCorpus>[0]);
    const body = (await response.json()) as { text: { slug: string }; verses: unknown[] };

    expect(response.status).toBe(200);
    expect(body.text.slug).toBe('siva-sutras');
    expect(body.verses).toHaveLength(2);
    expect(response.headers.get('cache-control')).toBe('public, max-age=300');
  });
});
