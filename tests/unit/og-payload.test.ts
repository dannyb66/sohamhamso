import { beforeEach, describe, expect, it } from 'vitest';
import type { CorpusDb } from '../../src/lib/corpus-db';
import {
  __resetLemmaIndexForTests,
  assignLemmaSlug,
  fetchLemmaOgPayload,
  fetchVerseOgPayload,
  parseLemmaOgUrl,
  parseVerseOgUrl,
} from '../../src/lib/seo/og-payload';

describe('og-payload route parsing', () => {
  it('normalizes verse cache keys down to validated path + lang', () => {
    const parsed = parseVerseOgUrl(
      new URL('https://sohamhamso.org/og/trika/siva-sutras/03/001?lang=hi&utm_source=test&v=123'),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.chapter).toBe(3);
    expect(parsed.verse).toBe(1);
    expect(parsed.pagePath).toBe('/hi/trika/siva-sutras/3/1');
    expect(parsed.cacheKeyUrl).toBe('https://sohamhamso.org/og/trika/siva-sutras/3/1?lang=hi');
  });

  it('rejects unsupported langs before building a cache key', () => {
    const parsed = parseVerseOgUrl(
      new URL('https://sohamhamso.org/og/trika/siva-sutras/1/1?lang=fr'),
    );

    expect(parsed).toEqual({
      ok: false,
      status: 400,
      code: 'invalid_lang',
      message: 'Unsupported OG lang: fr.',
    });
  });

  it('omits the default lang from lemma cache keys', () => {
    const parsed = parseLemmaOgUrl(new URL('https://sohamhamso.org/og/lemma/spanda?lang=en&noise=1'));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.pagePath).toBe('/lemma/spanda');
    expect(parsed.cacheKeyUrl).toBe('https://sohamhamso.org/og/lemma/spanda');
  });
});

describe('og-payload data loading', () => {
  beforeEach(() => {
    __resetLemmaIndexForTests();
  });

  it('falls back to English verse translation when the requested locale is missing', async () => {
    const route = parseVerseOgUrl(new URL('https://sohamhamso.org/og/trika/siva-sutras/1/1?lang=hi'));
    if (!route.ok) throw new Error('Expected a valid verse OG route.');

    const db = makeCorpusDb({
      get(sql) {
        if (sql.includes('requested_translation_text')) {
          return {
            title_en: 'Śiva Sūtras',
            title_sa: 'शिवसूत्राणि',
            tradition: 'trika',
            chapter: 1,
            verse_num: 1,
            devanagari: 'चैतन्यमात्मा',
            iast: 'caitanyam ātmā',
            requested_translation_text: null,
            requested_translation_translator: null,
            english_translation_text: 'Consciousness is the Self.',
            english_translation_translator: 'Editor',
          };
        }
        return undefined;
      },
    });

    const payload = await fetchVerseOgPayload(db, route);
    expect(payload).not.toBeNull();
    expect(payload?.secondaryTextKind).toBe('translation');
    expect(payload?.secondaryText).toBe('Consciousness is the Self.');
    expect(payload?.translationLang).toBe('en');
    expect(payload?.fallbackUsed).toBe(true);
  });

  it('builds deterministic lemma slugs and falls back to English glosses', async () => {
    const route = parseLemmaOgUrl(new URL('https://sohamhamso.org/og/lemma/siva-2?lang=ta'));
    if (!route.ok) throw new Error('Expected a valid lemma OG route.');

    const db = makeCorpusDb({
      all(sql, params) {
        if (sql.includes('GROUP BY g.lemma_iast')) {
          return [
            {
              lemma_iast: 'śiva',
              lemma_sa: 'शिव',
              occurrence_count: 8,
              first_verse_id: 11,
            },
            {
              lemma_iast: 'siva',
              lemma_sa: 'शिव',
              occurrence_count: 4,
              first_verse_id: 12,
            },
          ];
        }
        if (sql.includes('SELECT g.gloss_lang, g.gloss_text')) {
          expect(params).toEqual(['siva', 'ta', 'ta']);
          return [{ gloss_lang: 'en', gloss_text: 'auspicious, gracious' }];
        }
        return [];
      },
      get(sql, params) {
        if (sql.includes('SELECT\n        t.tradition')) {
          expect(params).toEqual(['siva']);
          return {
            tradition: 'trika',
            text_slug: 'siva-sutras',
            chapter: 1,
            verse_num: 1,
          };
        }
        return undefined;
      },
    });

    const payload = await fetchLemmaOgPayload(db, route);
    expect(payload).not.toBeNull();
    expect(payload?.slug).toBe('siva-2');
    expect(payload?.lemmaIast).toBe('siva');
    expect(payload?.glossLang).toBe('en');
    expect(payload?.fallbackUsed).toBe(true);
    expect(payload?.samplePath).toBe('/ta/trika/siva-sutras/1/1');
  });
});

describe('assignLemmaSlug', () => {
  it('preserves the first claim on the ASCII base and suffixes collisions', () => {
    const seen = new Set<string>();
    const first = assignLemmaSlug('śiva', seen);
    seen.add(first);
    const second = assignLemmaSlug('siva', seen);
    seen.add(second);
    const third = assignLemmaSlug('siva', seen);

    expect(first).toBe('siva');
    expect(second).toBe('siva-2');
    expect(third).toBe('siva-3');
  });
});

function makeCorpusDb(overrides: {
  all?: (sql: string, params: ReadonlyArray<string | number | null>) => unknown[];
  get?: (sql: string, params: ReadonlyArray<string | number | null>) => unknown;
}): CorpusDb {
  return {
    async all<T>(sql: string, params: ReadonlyArray<string | number | null> = []): Promise<T[]> {
      return (overrides.all?.(sql, params) ?? []) as T[];
    },
    async get<T>(
      sql: string,
      params: ReadonlyArray<string | number | null> = [],
    ): Promise<T | undefined> {
      return overrides.get?.(sql, params) as T | undefined;
    },
  };
}
