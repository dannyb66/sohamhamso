import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __OG_QUERY_TIMEOUT_MS_FOR_TESTS,
  __resetLibsqlClientImportForTests,
} from '../../functions/og/_shared';
import { type CorpusDb, __setCorpusDbForTests } from '../../src/lib/corpus-db';
import { __resetLemmaIndexForTests } from '../../src/lib/seo/og-payload';

const ROOT = resolve(__dirname, '..', '..');
const fakeDb: CorpusDb = {
  async all<T>(sql: string, params: ReadonlyArray<string | number | null> = []): Promise<T[]> {
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
      ] as T[];
    }
    if (sql.includes('SELECT g.gloss_lang, g.gloss_text')) {
      expect(params).toEqual(['siva', 'ta', 'ta']);
      return [{ gloss_lang: 'ta', gloss_text: 'சிவம்' }] as T[];
    }
    return [];
  },
  async get<T>(
    sql: string,
    params: ReadonlyArray<string | number | null> = [],
  ): Promise<T | undefined> {
    if (sql.includes('requested_translation_text')) {
      return {
        title_en: 'Śiva Sūtras',
        title_sa: 'शिवसूत्राणि',
        tradition: 'trika',
        chapter: 1,
        verse_num: 1,
        devanagari: 'चैतन्यमात्मा',
        iast: 'caitanyam ātmā',
        requested_translation_text: 'சித்தமே ஆத்மா',
        requested_translation_translator: 'Editor',
        english_translation_text: 'Consciousness is the Self.',
        english_translation_translator: 'Editor',
      } as T;
    }
    if (sql.includes('SELECT\n        t.tradition')) {
      expect(params).toEqual(['siva']);
      return {
        tradition: 'trika',
        text_slug: 'siva-sutras',
        chapter: 1,
        verse_num: 1,
      } as T;
    }
    return undefined;
  },
};

let handleLemmaOgRequest: typeof import('../../functions/og/_shared').handleLemmaOgRequest;
let handleVerseOgRequest: typeof import('../../functions/og/_shared').handleVerseOgRequest;

beforeAll(async () => {
  ({ handleLemmaOgRequest, handleVerseOgRequest } = await import('../../functions/og/_shared'));
});

beforeEach(() => {
  __setCorpusDbForTests(fakeDb);
  __resetLemmaIndexForTests();
});

afterAll(() => {
  __setCorpusDbForTests(null);
});

describe('OG function rendering', () => {
  it('renders verse OG success responses as PNG', async () => {
    const response = await handleVerseOgRequest(
      makeContext('https://sohamhamso.org/og/trika/siva-sutras/1/1?lang=ta'),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('X-OG-Format')).toBe('png');
    expect(response.headers.get('X-OG-Renderer')).toBe('resvg-wasm');
    expect(response.headers.get('X-OG-Fallback')).toBeNull();

    const dimensions = readPngDimensions(new Uint8Array(await response.arrayBuffer()));
    expect(dimensions).toEqual({ width: 1200, height: 630 });
  });

  it('renders lemma OG success responses as PNG', async () => {
    const response = await handleLemmaOgRequest(
      makeContext('https://sohamhamso.org/og/lemma/siva-2?lang=ta'),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('X-OG-Format')).toBe('png');
    expect(response.headers.get('X-OG-Renderer')).toBe('resvg-wasm');
    expect(response.headers.get('X-OG-Fallback')).toBeNull();

    const dimensions = readPngDimensions(new Uint8Array(await response.arrayBuffer()));
    expect(dimensions).toEqual({ width: 1200, height: 630 });
  });
});

describe('OG function precache (static JSON, no DB)', () => {
  // Production path: when `public/og-cache/<route>.json` exists (written by
  // `scripts/seo-build-og-cache.ts`), the OG handler reads it via
  // ASSETS.fetch and skips the libsql HTTP round-trip entirely. This block
  // verifies (a) the cache-hit path renders a valid PNG, and (b) the DB
  // backend is NOT consulted when the cache is warm.
  let dbCalls: { sql: string; params: ReadonlyArray<string | number | null> }[] = [];
  const recordingDb: CorpusDb = {
    async all<T>(sql: string, params: ReadonlyArray<string | number | null> = []): Promise<T[]> {
      dbCalls.push({ sql, params });
      return [] as T[];
    },
    async get<T>(
      sql: string,
      params: ReadonlyArray<string | number | null> = [],
    ): Promise<T | undefined> {
      dbCalls.push({ sql, params });
      return undefined;
    },
  };

  beforeEach(() => {
    dbCalls = [];
    __setCorpusDbForTests(recordingDb);
    __resetLemmaIndexForTests();
  });

  afterAll(() => {
    __setCorpusDbForTests(null);
  });

  it('serves a PNG from the precache without touching the DB', async () => {
    const cachedJson = {
      tradition: 'trika',
      textSlug: 'siva-sutras',
      titleEn: 'Śiva Sūtras',
      titleSa: 'शिवसूत्राणि',
      chapter: 1,
      verseNum: 1,
      devanagari: 'चैतन्यमात्मा',
      iast: 'caitanyam ātmā',
      translationsByLang: {
        en: { translationText: 'Consciousness is the Self.', translator: 'Editor' },
        ta: { translationText: 'சித்தமே ஆத்மா', translator: 'Editor' },
      },
    };

    const response = await handleVerseOgRequest(
      makeContext('https://sohamhamso.org/og/trika/siva-sutras/1/1?lang=ta', {
        ogCacheOverrides: {
          '/og-cache/trika/siva-sutras/1/1.json': cachedJson,
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('X-OG-Renderer')).toBe('resvg-wasm');
    expect(response.headers.get('X-OG-Fallback')).toBeNull();
    // Load-bearing: the DB backend received ZERO queries because the
    // precache hit short-circuited the loader.
    expect(dbCalls).toHaveLength(0);
  });

  it('falls through to the DB when the precache returns 404', async () => {
    // Same recordingDb stubs out the DB (returns nothing), so the request
    // ends in a fallback asset response. The point of this test is that
    // a missing cache file does NOT short-circuit — the handler still
    // tries the DB path, which is the structural compatibility we promise
    // for verses added between builds.
    const response = await handleVerseOgRequest(
      makeContext('https://sohamhamso.org/og/trika/siva-sutras/99/99?lang=ta'),
    );

    // Empty DB → no row → 404 short-cache response.
    expect(response.status).toBe(404);
    // Two queries observed: one is the verse SELECT itself. We don't
    // pin the exact count (sub-selects collapse into one execute call
    // for the libsql backend), but the DB path WAS exercised.
    expect(dbCalls.length).toBeGreaterThan(0);
  });
});

describe('OG function abort-on-timeout (libsql HTTP)', () => {
  const originalUrl = process.env.TURSO_CORPUS_URL;
  const originalToken = process.env.TURSO_CORPUS_AUTH_TOKEN;
  const originalFetch = globalThis.fetch;
  let capturedSignals: AbortSignal[] = [];
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Force the OG handler down the per-request abort-capable libsql path.
    // The strict env-var predicate in `getAbortableCorpusDb` is what flips
    // routing — these vars are intentionally NOT set in the other describe
    // blocks above so the existing __setCorpusDbForTests path keeps winning.
    process.env.TURSO_CORPUS_URL = 'https://example.turso.io';
    process.env.TURSO_CORPUS_AUTH_TOKEN = 'test-token';
    // Clear the corpus-db injection — we want the OG handler to call into
    // the per-request libsql client created inside _shared.ts.
    __setCorpusDbForTests(null);

    capturedSignals = [];
    fetchSpy = vi.fn((_input: unknown, init?: { signal?: AbortSignal }) => {
      // Capture the signal so the assertion can confirm it actually fired.
      // Returns a promise that NEVER resolves on its own — the only way to
      // settle it is for `signal.abort()` to fire, which is the behavior
      // we're verifying.
      return new Promise<Response>((_resolve, reject) => {
        if (init?.signal) {
          capturedSignals.push(init.signal);
          init.signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }
        // No resolution path — simulates Turso hanging.
      });
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.TURSO_CORPUS_URL;
    else process.env.TURSO_CORPUS_URL = originalUrl;
    if (originalToken === undefined) delete process.env.TURSO_CORPUS_AUTH_TOKEN;
    else process.env.TURSO_CORPUS_AUTH_TOKEN = originalToken;
    globalThis.fetch = originalFetch;
    // Restore the injected fake DB so the other describe block's beforeEach
    // re-injection sequence is consistent.
    __setCorpusDbForTests(fakeDb);
  });

  it('aborts libsql HTTP via AbortSignal and returns the cached fallback', async () => {
    const response = await handleVerseOgRequest(
      makeContext('https://sohamhamso.org/og/trika/siva-sutras/1/1?lang=ta'),
    );

    // Fallback asset is served — NOT a hang, NOT the 1-year-immutable success.
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
    expect(response.headers.get('X-OG-Fallback')).toBe('asset');

    // libsql's custom-fetch wrapper was invoked (i.e. the per-request client
    // path ran, not the bun/test-injected backend).
    expect(fetchSpy).toHaveBeenCalled();

    // At least one captured signal actually fired — the abort wiring is real.
    expect(capturedSignals.length).toBeGreaterThan(0);
    expect(capturedSignals.some((s) => s.aborted)).toBe(true);
  });
});

describe('OG function cold-start budget (regression: 100% fallback bug)', () => {
  // The production bug was: every OG response returned the default fallback
  // PNG with `X-OG-Fallback-Reason: OG payload query timed out` because the
  // per-request `await import('@libsql/client/web')` cost on a cold worker
  // isolate exceeded the 500ms `OG_QUERY_TIMEOUT_MS` budget. This block
  // guards both halves of the fix:
  //   1. Timeout budget is large enough to absorb a real Turso round-trip.
  //   2. The libsql import is memoized at module scope so only the first
  //      request per isolate pays the chunk-load cost.

  const originalUrl = process.env.TURSO_CORPUS_URL;
  const originalToken = process.env.TURSO_CORPUS_AUTH_TOKEN;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.TURSO_CORPUS_URL = 'https://example.turso.io';
    process.env.TURSO_CORPUS_AUTH_TOKEN = 'test-token';
    __setCorpusDbForTests(null);
    __resetLibsqlClientImportForTests();
    __resetLemmaIndexForTests();
  });

  afterEach(() => {
    // biome-ignore lint/performance/noDelete: env-var restore — required
    if (originalUrl === undefined) delete process.env.TURSO_CORPUS_URL;
    else process.env.TURSO_CORPUS_URL = originalUrl;
    // biome-ignore lint/performance/noDelete: env-var restore — required
    if (originalToken === undefined) delete process.env.TURSO_CORPUS_AUTH_TOKEN;
    else process.env.TURSO_CORPUS_AUTH_TOKEN = originalToken;
    globalThis.fetch = originalFetch;
    __setCorpusDbForTests(fakeDb);
  });

  it('keeps OG_QUERY_TIMEOUT_MS large enough for a cold Turso round-trip', () => {
    // Production data: warm libsql HTTP queries against Turso complete in
    // ~450ms; cold isolates push the FIRST request past 500ms. The previous
    // 500ms budget was the source of the 100% fallback rate in Phase 8. Any
    // future tightening of this constant MUST be paired with import + client
    // pre-warming, or the regression returns.
    expect(__OG_QUERY_TIMEOUT_MS_FOR_TESTS).toBeGreaterThanOrEqual(1500);
  });

  it('memoizes the @libsql/client/web import across multiple OG requests', async () => {
    // Drive two cold OG requests through the per-request libsql path. We
    // stub `globalThis.fetch` to reject immediately so each request takes
    // the fallback path quickly — we only care that the libsql `/web` chunk
    // import was paid AT MOST ONCE across both requests.
    const fetchSpy = vi.fn(() =>
      Promise.reject(new TypeError('test: synthetic libsql fetch failure')),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    // Pre-condition: the test hook reset the memoization, so no import paid.
    const { __libsqlClientImportPaidForTests } = await import('../../functions/og/_shared');
    expect(__libsqlClientImportPaidForTests()).toBe(false);

    const r1 = await handleVerseOgRequest(
      makeContext('https://sohamhamso.org/og/trika/siva-sutras/1/1?lang=ta'),
    );
    expect(r1.status).toBe(200);
    expect(r1.headers.get('X-OG-Fallback')).toBe('asset');

    // After the first request: import IS paid (memoized).
    expect(__libsqlClientImportPaidForTests()).toBe(true);

    const r2 = await handleVerseOgRequest(
      makeContext('https://sohamhamso.org/og/trika/siva-sutras/1/2?lang=ta'),
    );
    expect(r2.status).toBe(200);
    expect(r2.headers.get('X-OG-Fallback')).toBe('asset');

    // Import is still memoized (didn't reset between requests). This is the
    // load-bearing assertion: if a future refactor accidentally drops the
    // module-scope memoization, this state would flip and we'd notice.
    expect(__libsqlClientImportPaidForTests()).toBe(true);

    // Sanity: the per-request libsql client custom-fetch actually ran on
    // both requests (i.e. we exercised the path under test, not the test
    // backend).
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

function makeContext(
  url: string,
  options: { ogCacheOverrides?: Record<string, unknown> } = {},
): import('../../functions/og/_shared').OgFunctionContext {
  return {
    request: new Request(url),
    env: {
      ASSETS: {
        fetch: async (input) => {
          const requestUrl =
            input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
          // OG verse-text precache lookups: by default these tests want to
          // exercise the DB path (existing assertions assume the injected
          // fake DB is consulted). Returning 404 here makes the OG handler
          // fall through to the DB. A test that wants to verify the cache-
          // hit path can pass `ogCacheOverrides` keyed by pathname.
          if (requestUrl.pathname.startsWith('/og-cache/')) {
            const override = options.ogCacheOverrides?.[requestUrl.pathname];
            if (override !== undefined) {
              return new Response(JSON.stringify(override), {
                status: 200,
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
              });
            }
            return new Response('Not found', { status: 404 });
          }
          const assetPath = resolve(ROOT, 'public', requestUrl.pathname.replace(/^\//, ''));
          if (!existsSync(assetPath)) return new Response('Not found', { status: 404 });
          return new Response(readFileSync(assetPath), {
            status: 200,
            headers: {
              'Content-Type': mimeTypeForPath(assetPath),
            },
          });
        },
      },
    },
    waitUntil: () => {},
  };
}

function mimeTypeForPath(filePath: string): string {
  const extension = extname(filePath).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.svg') return 'image/svg+xml; charset=utf-8';
  if (extension === '.woff2') return 'font/woff2';
  if (extension === '.ttf') return 'font/ttf';
  if (extension === '.ttc') return 'font/collection';
  if (extension === '.wasm') return 'application/wasm';
  return 'application/octet-stream';
}

function readPngDimensions(buffer: Uint8Array): { height: number; width: number } {
  return {
    width: Buffer.from(buffer).readUInt32BE(16),
    height: Buffer.from(buffer).readUInt32BE(20),
  };
}
