/** Local/static-asset lexical search. No database or network dependency. */

import type { VerseHit } from './search-types';

type SearchRow = {
  verse_id: number;
  text_id: string;
  text_slug: string;
  text_title: string;
  tradition: string;
  chapter: number;
  verse_num: number;
  devanagari: string;
  iast: string | null;
  translation_excerpt: string | null;
  search_text?: string;
};

type SearchShard = { version: 1; lang: string; rows: SearchRow[] };
type StaticAssets = { fetch: (request: Request) => Promise<Response> };
type StaticHit = Omit<VerseHit, 'source'> & { source: 'lexical' };

const cache = new Map<string, Promise<SearchShard | null>>();

async function loadShard(
  lang: string,
  assets?: StaticAssets,
  baseUrl?: URL,
): Promise<SearchShard | null> {
  const key = `${assets ? 'assets' : 'local'}:${lang}`;
  const existing = cache.get(key);
  if (existing) {
    cache.delete(key);
    cache.set(key, existing);
    return existing;
  }

  const promise = (async () => {
    try {
      let response: Response;
      if (assets && baseUrl) {
        const compressedUrl = new URL(
          `/_data/corpus/search/${encodeURIComponent(lang)}.json.gz`,
          baseUrl,
        );
        response = await assets.fetch(new Request(compressedUrl));
        if (response.ok) {
          const stream = response.body?.pipeThrough(new DecompressionStream('gzip'));
          if (!stream) return null;
          return JSON.parse(await new Response(stream).text()) as SearchShard;
        }
        const url = new URL(`/_data/corpus/search/${encodeURIComponent(lang)}.json`, baseUrl);
        response = await assets.fetch(new Request(url));
      } else {
        const root = [process.cwd(), 'dist', '_data', 'corpus', 'search'].join('/');
        const { readFile } = await import('node:fs/promises');
        let raw: string;
        try {
          const { gunzipSync } = await import('node:zlib');
          raw = gunzipSync(await readFile(`${root}/${lang}.json.gz`)).toString('utf8');
        } catch {
          raw = await readFile(`${root}/${lang}.json`, 'utf8');
        }
        return JSON.parse(raw) as SearchShard;
      }
      if (!response.ok) return null;
      return (await response.json()) as SearchShard;
    } catch {
      return null;
    }
  })();
  cache.set(key, promise);
  // Retain only the active locales rather than every full-text search shard.
  while (cache.size > 2) cache.delete(cache.keys().next().value as string);
  void promise.then((value) => {
    if (value === null && cache.get(key) === promise) cache.delete(key);
  });
  return promise;
}

function variants(query: string): string[] {
  const q = query.trim().toLowerCase();
  const out = new Set([q]);
  const synonyms: Record<string, string[]> = {
    siva: ['shiva', 'śiva', 'शिव'],
    shiva: ['siva', 'śiva', 'शिव'],
    śiva: ['siva', 'shiva', 'शिव'],
    krishna: ['krsna', 'kṛṣṇa', 'कृष्ण'],
    krsna: ['krishna', 'kṛṣṇa', 'कृष्ण'],
    kṛṣṇa: ['krsna', 'krishna', 'कृष्ण'],
    shakti: ['śakti', 'sakti', 'शक्ति'],
    śakti: ['shakti', 'sakti', 'शक्ति'],
    spanda: ['स्पन्द'],
    pratyabhijna: ['pratyabhijñā', 'प्रत्यभिज्ञा'],
    pratyabhijñā: ['pratyabhijna', 'प्रत्यभिज्ञा'],
  };
  for (const word of q.split(/\s+/)) for (const value of synonyms[word] ?? []) out.add(value);
  return [...out];
}

export async function staticLexicalSearch(
  query: string,
  lang: string,
  limit: number,
  options: { assets?: StaticAssets; baseUrl?: URL } = {},
): Promise<VerseHit[] | null> {
  const shard = await loadShard(lang, options.assets, options.baseUrl);
  if (!shard) return null;
  const terms = variants(query);
  return shard.rows
    .map((row) => {
      const haystack = [row.devanagari, row.iast, row.search_text ?? row.translation_excerpt]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      const matches = terms.filter((term) => haystack.includes(term)).length;
      const { search_text: _searchText, ...hit } = row;
      return matches
        ? ({ ...hit, score: 1 / matches, source: 'lexical' } satisfies StaticHit)
        : null;
    })
    .filter((row): row is StaticHit => row !== null)
    .sort((a, b) => a.score - b.score || a.verse_id - b.verse_id)
    .slice(0, limit);
}

export function __resetStaticSearchCacheForTests(): void {
  cache.clear();
}
