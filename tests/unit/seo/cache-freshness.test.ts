import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type FreshnessResult,
  buildTargets,
  checkFreshness,
  evaluateFreshness,
} from '../../../scripts/seo-cache-freshness';

// ---------------------------------------------------------------------------
// fetch mock setup — restore after each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helper: build a FreshnessResult directly (no fetch)
// ---------------------------------------------------------------------------

function makeResult(
  name: string,
  cfCacheStatus: string | null,
): FreshnessResult {
  const skip = cfCacheStatus === null;
  const fresh = skip ? null : cfCacheStatus !== 'HIT';
  return {
    name,
    url: `https://sohamhamso.org/${name}`,
    status: 200,
    cfCacheStatus,
    skip,
    fresh,
  };
}

// ---------------------------------------------------------------------------
// evaluateFreshness — pure-function tests (no fetch)
// ---------------------------------------------------------------------------

describe('evaluateFreshness', () => {
  it('passes when all URLs return cf-cache-status: MISS', () => {
    const results = [
      makeResult('robots.txt', 'MISS'),
      makeResult('sitemap-index.xml', 'MISS'),
      makeResult('sitemap-verses.xml', 'MISS'),
    ];
    const summary = evaluateFreshness(results);

    expect(summary.allFresh).toBe(true);
    expect(summary.failures).toHaveLength(0);
    expect(summary.cfHeaderAbsent).toBe(false);
  });

  it('passes when all URLs return cf-cache-status: DYNAMIC (treated same as MISS)', () => {
    const results = [
      makeResult('robots.txt', 'DYNAMIC'),
      makeResult('sitemap-index.xml', 'DYNAMIC'),
    ];
    const summary = evaluateFreshness(results);

    expect(summary.allFresh).toBe(true);
    expect(summary.failures).toHaveLength(0);
  });

  it('fails when any URL returns cf-cache-status: HIT', () => {
    const results = [
      makeResult('robots.txt', 'MISS'),
      makeResult('sitemap-index.xml', 'HIT'),
      makeResult('sitemap-verses.xml', 'MISS'),
    ];
    const summary = evaluateFreshness(results);

    expect(summary.allFresh).toBe(false);
    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0].name).toBe('sitemap-index.xml');
  });

  it('reports all stale URLs when multiple have HIT', () => {
    const results = [
      makeResult('robots.txt', 'HIT'),
      makeResult('sitemap-index.xml', 'MISS'),
      makeResult('sitemap-verses.xml', 'HIT'),
    ];
    const summary = evaluateFreshness(results);

    expect(summary.allFresh).toBe(false);
    expect(summary.failures.map((f) => f.name).sort()).toEqual([
      'robots.txt',
      'sitemap-verses.xml',
    ]);
  });

  it('skips (no failure) when cf-cache-status header is absent — sets cfHeaderAbsent=true', () => {
    const results = [
      makeResult('robots.txt', null),
      makeResult('sitemap-index.xml', null),
    ];
    const summary = evaluateFreshness(results);

    expect(summary.allFresh).toBe(true);
    expect(summary.failures).toHaveLength(0);
    expect(summary.cfHeaderAbsent).toBe(true);
  });

  it('skips absent-header URLs but fails on HIT URLs in the same run', () => {
    const results = [
      makeResult('robots.txt', null),        // skip
      makeResult('sitemap-index.xml', 'HIT'), // fail
      makeResult('sitemap-verses.xml', 'MISS'), // pass
    ];
    const summary = evaluateFreshness(results);

    expect(summary.allFresh).toBe(false);
    expect(summary.failures).toHaveLength(1);
    expect(summary.cfHeaderAbsent).toBe(true);
  });

  it('passes for cf-cache-status: EXPIRED (not HIT — treated as fresh)', () => {
    // The script logic: fresh = cfCacheStatus !== 'HIT'
    // EXPIRED is not HIT, so fresh=true
    const results = [makeResult('robots.txt', 'EXPIRED')];
    const summary = evaluateFreshness(results);

    expect(summary.allFresh).toBe(true);
    expect(summary.failures).toHaveLength(0);
  });

  it('passes for cf-cache-status: BYPASS', () => {
    const results = [makeResult('robots.txt', 'BYPASS')];
    const summary = evaluateFreshness(results);

    expect(summary.allFresh).toBe(true);
  });

  it('passes for cf-cache-status: STALE', () => {
    const results = [makeResult('robots.txt', 'STALE')];
    const summary = evaluateFreshness(results);

    expect(summary.allFresh).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkFreshness — fetch mock tests
// ---------------------------------------------------------------------------

describe('checkFreshness', () => {
  const ORIGIN = 'https://sohamhamso.org';

  function mockFetch(cfCacheStatus: string | null, status = 200): void {
    const headers: Record<string, string> = {};
    if (cfCacheStatus !== null) {
      headers['cf-cache-status'] = cfCacheStatus;
    }
    vi.mocked(global.fetch).mockResolvedValue(new Response('', { status, headers }));
  }

  it('returns fresh=true and skip=false for cf-cache-status: MISS', async () => {
    mockFetch('MISS');
    const result = await checkFreshness(ORIGIN, { name: 'robots.txt', path: '/robots.txt', key: true });

    expect(result.fresh).toBe(true);
    expect(result.skip).toBe(false);
    expect(result.cfCacheStatus).toBe('MISS');
  });

  it('returns fresh=true and skip=false for cf-cache-status: DYNAMIC', async () => {
    mockFetch('DYNAMIC');
    const result = await checkFreshness(ORIGIN, { name: 'robots.txt', path: '/robots.txt', key: true });

    expect(result.fresh).toBe(true);
    expect(result.skip).toBe(false);
  });

  it('returns fresh=false and skip=false for cf-cache-status: HIT', async () => {
    mockFetch('HIT');
    const result = await checkFreshness(ORIGIN, { name: 'sitemap-index.xml', path: '/sitemap-index.xml', key: true });

    expect(result.fresh).toBe(false);
    expect(result.skip).toBe(false);
    expect(result.cfCacheStatus).toBe('HIT');
  });

  it('returns fresh=null and skip=true when cf-cache-status header is absent', async () => {
    mockFetch(null);
    const result = await checkFreshness(ORIGIN, { name: 'robots.txt', path: '/robots.txt', key: true });

    expect(result.fresh).toBeNull();
    expect(result.skip).toBe(true);
    expect(result.cfCacheStatus).toBeNull();
  });

  it('returns fresh=true for cf-cache-status: EXPIRED', async () => {
    mockFetch('EXPIRED');
    const result = await checkFreshness(ORIGIN, { name: 'robots.txt', path: '/robots.txt', key: true });

    expect(result.fresh).toBe(true);
    expect(result.skip).toBe(false);
  });

  it('constructs the correct URL from origin + path', async () => {
    mockFetch('MISS');
    await checkFreshness(ORIGIN, { name: 'robots.txt', path: '/robots.txt', key: true });

    const [url] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://sohamhamso.org/robots.txt');
  });

  it('sends the correct User-Agent header', async () => {
    mockFetch('MISS');
    await checkFreshness(ORIGIN, { name: 'robots.txt', path: '/robots.txt', key: true });

    const [_url, init] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit];
    const headers = init?.headers as Record<string, string>;
    expect(headers['User-Agent']).toBe('sohamhamso-seo-cache-freshness/1.0');
  });

  it('uses redirect: manual', async () => {
    mockFetch('MISS');
    await checkFreshness(ORIGIN, { name: 'robots.txt', path: '/robots.txt', key: true });

    const [_url, init] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit];
    expect((init as RequestInit).redirect).toBe('manual');
  });
});

// ---------------------------------------------------------------------------
// buildTargets — URL list tests
// ---------------------------------------------------------------------------

describe('buildTargets', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('always includes robots.txt as a key target', () => {
    const targets = buildTargets();
    const robots = targets.find((t) => t.name === 'robots.txt');

    expect(robots).toBeDefined();
    expect(robots?.path).toBe('/robots.txt');
    expect(robots?.key).toBe(true);
  });

  it('includes all four sitemaps as key targets', () => {
    const targets = buildTargets();
    const names = targets.map((t) => t.name);

    expect(names).toContain('sitemap-index.xml');
    expect(names).toContain('sitemap-verses.xml');
    expect(names).toContain('sitemap-texts.xml');
    expect(names).toContain('sitemap-lemmas.xml');
    expect(names).toContain('sitemap-chrome.xml');
  });

  it('all static targets have key=true', () => {
    const targets = buildTargets();
    const staticTargets = targets.filter((t) =>
      ['robots.txt', 'sitemap-index.xml', 'sitemap-verses.xml', 'sitemap-texts.xml', 'sitemap-lemmas.xml', 'sitemap-chrome.xml'].includes(t.name),
    );

    for (const t of staticTargets) {
      expect(t.key).toBe(true);
    }
  });

  it('includes a locale page target for English at path /', () => {
    // Default: only 'en' is live (LOCALE_URLS_LIVE not set)
    vi.stubEnv('LOCALE_URLS_LIVE', '');
    vi.stubEnv('LOCALE_URLS_LIVE_LANGS', '');

    const targets = buildTargets();
    const enPage = targets.find((t) => t.name === 'page-en');

    expect(enPage).toBeDefined();
    expect(enPage?.path).toBe('/');
  });

  it('includes locale subpath for non-English live locales', () => {
    vi.stubEnv('LOCALE_URLS_LIVE_LANGS', 'en,hi');

    const targets = buildTargets();
    const hiPage = targets.find((t) => t.name === 'page-hi');

    expect(hiPage).toBeDefined();
    expect(hiPage?.path).toBe('/hi');
  });

  it('probes at most 3 locales (first 3 from liveLocaleSet)', () => {
    vi.stubEnv('LOCALE_URLS_LIVE_LANGS', 'en,hi,bn,te');

    const targets = buildTargets();
    const localePages = targets.filter((t) => t.name.startsWith('page-'));

    expect(localePages.length).toBeLessThanOrEqual(3);
  });
});
