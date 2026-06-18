import { afterEach, describe, expect, it } from 'vitest';
import {
  ENGLISH_ONLY_NOINDEX_CHROME_BASE_PATHS,
  LOCALIZED_CHROME_BASE_PATHS,
  getChromeAvailableLangs,
  getChromeSitemapPaths,
} from '../../../src/lib/seo';

const originalLocaleUrlsLive = process.env.LOCALE_URLS_LIVE;
const originalLocaleUrlsLiveLangs = process.env.LOCALE_URLS_LIVE_LANGS;

describe('chrome route helpers', () => {
  afterEach(() => {
    if (originalLocaleUrlsLive === undefined) delete process.env.LOCALE_URLS_LIVE;
    else process.env.LOCALE_URLS_LIVE = originalLocaleUrlsLive;

    if (originalLocaleUrlsLiveLangs === undefined) delete process.env.LOCALE_URLS_LIVE_LANGS;
    else process.env.LOCALE_URLS_LIVE_LANGS = originalLocaleUrlsLiveLangs;
  });

  it('returns the live locale cluster for localized chrome pages', () => {
    delete process.env.LOCALE_URLS_LIVE;
    process.env.LOCALE_URLS_LIVE_LANGS = 'hi,ta';

    expect(getChromeAvailableLangs()).toEqual(['en', 'hi', 'ta']);
  });

  it('emits localized sitemap URLs only for the indexable chrome pages', () => {
    delete process.env.LOCALE_URLS_LIVE;
    process.env.LOCALE_URLS_LIVE_LANGS = 'hi';

    const paths = getChromeSitemapPaths();

    expect(paths).toContain('/');
    expect(paths).toContain('/hi');
    expect(paths).toContain('/hi/about/methodology');
    expect(paths).toContain('/hi/texts');
    expect(paths).toContain('/hi/daily');
    expect(paths).not.toContain('/hi/search');
    expect(paths).not.toContain('/hi/sample');
  });

  it('keeps the localized and english-only chrome inventories disjoint', () => {
    for (const basePath of LOCALIZED_CHROME_BASE_PATHS) {
      expect(ENGLISH_ONLY_NOINDEX_CHROME_BASE_PATHS).not.toContain(basePath);
    }
  });
});
