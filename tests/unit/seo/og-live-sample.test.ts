import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type OgProbeResult,
  buildOgUrl,
  probeOg,
  summarizeOgResults,
} from '../../../scripts/seo-og-live-sample';

// ---------------------------------------------------------------------------
// fetch mock setup — restore after each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  // probeOg uses the global fetch; intercept it for each test.
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helper: make a minimal Response with specific headers
// ---------------------------------------------------------------------------

function makeResponse(headers: Record<string, string>, status = 200): Response {
  return new Response('', { status, headers });
}

// ---------------------------------------------------------------------------
// buildOgUrl
// ---------------------------------------------------------------------------

describe('buildOgUrl', () => {
  it('omits ?lang param for English (default locale)', () => {
    const url = buildOgUrl('https://sohamhamso.org', 1, 1, 'en');
    expect(url).toBe('https://sohamhamso.org/og/trika/siva-sutras/1/1');
    expect(url).not.toContain('lang');
  });

  it('appends ?lang=hi for Hindi locale', () => {
    const url = buildOgUrl('https://sohamhamso.org', 1, 5, 'hi');
    expect(url).toBe('https://sohamhamso.org/og/trika/siva-sutras/1/5?lang=hi');
  });

  it('appends ?lang=bn for Bengali locale', () => {
    const url = buildOgUrl('https://sohamhamso.org', 2, 3, 'bn');
    expect(url).toBe('https://sohamhamso.org/og/trika/siva-sutras/2/3?lang=bn');
  });

  it('interpolates chapter and verse correctly', () => {
    const url = buildOgUrl('https://example.com', 3, 10, 'en');
    expect(url).toContain('/og/trika/siva-sutras/3/10');
  });

  it('strips no trailing slash from origin', () => {
    // origin without trailing slash is the expected calling convention
    const url = buildOgUrl('https://sohamhamso.org', 1, 1, 'hi');
    expect(url).not.toContain('//og');
  });
});

// ---------------------------------------------------------------------------
// probeOg — fetch mock tests
// ---------------------------------------------------------------------------

describe('probeOg', () => {
  it('returns fallback=false when X-OG-Renderer is resvg-wasm and no X-OG-Fallback header', async () => {
    vi.mocked(global.fetch).mockResolvedValue(makeResponse({ 'X-OG-Renderer': 'resvg-wasm' }));

    const result = await probeOg('https://sohamhamso.org/og/trika/siva-sutras/1/1', 'en');

    expect(result.fallback).toBe(false);
    expect(result.fallbackReason).toBeNull();
    expect(result.renderer).toBe('resvg-wasm');
    expect(result.status).toBe(200);
  });

  it('returns fallback=true when X-OG-Fallback header is present', async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      makeResponse({
        'X-OG-Fallback': 'asset',
        'X-OG-Fallback-Reason': 'wasm-timeout',
        'X-OG-Renderer': 'sharp',
      }),
    );

    const result = await probeOg('https://sohamhamso.org/og/trika/siva-sutras/1/1', 'hi');

    expect(result.fallback).toBe(true);
    expect(result.fallbackReason).toBe('wasm-timeout');
    expect(result.lang).toBe('hi');
  });

  it('records the lang and url in the result', async () => {
    vi.mocked(global.fetch).mockResolvedValue(makeResponse({ 'X-OG-Renderer': 'resvg-wasm' }));

    const result = await probeOg('https://example.com/og/trika/siva-sutras/2/3', 'bn');

    expect(result.url).toBe('https://example.com/og/trika/siva-sutras/2/3');
    expect(result.lang).toBe('bn');
  });

  it('sends the correct User-Agent header', async () => {
    vi.mocked(global.fetch).mockResolvedValue(makeResponse({ 'X-OG-Renderer': 'resvg-wasm' }));

    await probeOg('https://sohamhamso.org/og/trika/siva-sutras/1/1', 'en');

    const [_url, init] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit];
    const headers = init?.headers as Record<string, string>;
    expect(headers['User-Agent']).toBe('sohamhamso-seo-og-sample/1.0');
  });

  it('uses redirect: manual', async () => {
    vi.mocked(global.fetch).mockResolvedValue(makeResponse({ 'X-OG-Renderer': 'resvg-wasm' }));

    await probeOg('https://sohamhamso.org/og/trika/siva-sutras/1/1', 'en');

    const [_url, init] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit];
    expect((init as RequestInit).redirect).toBe('manual');
  });
});

// ---------------------------------------------------------------------------
// summarizeOgResults — pure-function tests (no fetch needed)
// ---------------------------------------------------------------------------

function makeResult(lang: string, fallback: boolean): OgProbeResult {
  return {
    lang,
    url: `https://sohamhamso.org/og/trika/siva-sutras/1/1${lang === 'en' ? '' : `?lang=${lang}`}`,
    status: 200,
    renderer: fallback ? null : 'resvg-wasm',
    fallback,
    fallbackReason: fallback ? 'asset' : null,
  };
}

function makeResults(total: number, fallbackCount: number, lang = 'en'): OgProbeResult[] {
  return Array.from({ length: total }, (_, i) => makeResult(lang, i < fallbackCount));
}

describe('summarizeOgResults', () => {
  describe('fallback rate calculation', () => {
    it('returns 0% rate and passes when no responses have X-OG-Fallback', () => {
      // 120 results, 0 fallbacks — simulates all locales × 10 verses × ~12 locales
      const results = makeResults(120, 0);
      const summary = summarizeOgResults(results, 2);

      expect(summary.totalFallback).toBe(0);
      expect(summary.total).toBe(120);
      expect(summary.overallRate).toBe(0);
      expect(summary.passed).toBe(true);
    });

    it('returns 2.5% rate and fails with default threshold=2 when 3/120 have fallback', () => {
      const results = makeResults(120, 3);
      const summary = summarizeOgResults(results, 2);

      expect(summary.totalFallback).toBe(3);
      expect(summary.overallRate).toBeCloseTo(2.5, 5);
      expect(summary.passed).toBe(false);
    });

    it('returns ~0.83% rate and passes with default threshold=2 when 1/120 have fallback', () => {
      const results = makeResults(120, 1);
      const summary = summarizeOgResults(results, 2);

      expect(summary.totalFallback).toBe(1);
      expect(summary.overallRate).toBeCloseTo(0.8333, 3);
      expect(summary.passed).toBe(true);
    });

    it('passes when rate equals the threshold exactly', () => {
      // 2/100 = exactly 2%
      const results = makeResults(100, 2);
      const summary = summarizeOgResults(results, 2);

      expect(summary.overallRate).toBeCloseTo(2, 5);
      expect(summary.passed).toBe(true);
    });
  });

  describe('threshold customization', () => {
    it('allows 3/120 fallbacks (2.5%) when --threshold=5', () => {
      const results = makeResults(120, 3);
      const summary = summarizeOgResults(results, 5);

      expect(summary.passed).toBe(true);
    });

    it('rejects 3/120 fallbacks (2.5%) when --threshold=1', () => {
      const results = makeResults(120, 3);
      const summary = summarizeOgResults(results, 1);

      expect(summary.passed).toBe(false);
    });

    it('allows 6/100 fallbacks (6%) when --threshold=10', () => {
      const results = makeResults(100, 6);
      const summary = summarizeOgResults(results, 10);

      expect(summary.passed).toBe(true);
    });
  });

  describe('per-locale breakdown', () => {
    it('groups results by lang in byLocale', () => {
      const results = [...makeResults(10, 0, 'en'), ...makeResults(10, 2, 'hi')];
      const summary = summarizeOgResults(results, 2);

      expect(summary.byLocale.get('en')).toEqual({ total: 10, fallback: 0 });
      expect(summary.byLocale.get('hi')).toEqual({ total: 10, fallback: 2 });
    });

    it('overall rate uses all results regardless of locale', () => {
      const results = [...makeResults(60, 0, 'en'), ...makeResults(60, 3, 'hi')];
      const summary = summarizeOgResults(results, 2);

      // 3/120 = 2.5%
      expect(summary.total).toBe(120);
      expect(summary.totalFallback).toBe(3);
      expect(summary.overallRate).toBeCloseTo(2.5, 5);
    });
  });

  describe('edge cases', () => {
    it('returns 0% for empty results array without throwing', () => {
      const summary = summarizeOgResults([], 2);

      expect(summary.total).toBe(0);
      expect(summary.overallRate).toBe(0);
      expect(summary.passed).toBe(true);
    });

    it('returns 100% when all results are fallbacks', () => {
      const results = makeResults(10, 10);
      const summary = summarizeOgResults(results, 2);

      expect(summary.overallRate).toBe(100);
      expect(summary.passed).toBe(false);
    });
  });
});
