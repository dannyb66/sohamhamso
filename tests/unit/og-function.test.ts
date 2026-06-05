import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setCorpusDbForTests, type CorpusDb } from '../../src/lib/corpus-db';
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
    const response = await handleVerseOgRequest(makeContext('https://sohamhamso.org/og/trika/siva-sutras/1/1?lang=ta'));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('X-OG-Format')).toBe('png');
    expect(response.headers.get('X-OG-Renderer')).toBe('resvg-wasm');
    expect(response.headers.get('X-OG-Fallback')).toBeNull();

    const dimensions = readPngDimensions(new Uint8Array(await response.arrayBuffer()));
    expect(dimensions).toEqual({ width: 1200, height: 630 });
  });

  it('renders lemma OG success responses as PNG', async () => {
    const response = await handleLemmaOgRequest(makeContext('https://sohamhamso.org/og/lemma/siva-2?lang=ta'));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('X-OG-Format')).toBe('png');
    expect(response.headers.get('X-OG-Renderer')).toBe('resvg-wasm');
    expect(response.headers.get('X-OG-Fallback')).toBeNull();

    const dimensions = readPngDimensions(new Uint8Array(await response.arrayBuffer()));
    expect(dimensions).toEqual({ width: 1200, height: 630 });
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

function makeContext(url: string): import('../../functions/og/_shared').OgFunctionContext {
  return {
    request: new Request(url),
    env: {
      ASSETS: {
        fetch: async (input) => {
          const requestUrl =
            input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
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
