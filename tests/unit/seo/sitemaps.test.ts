import { afterEach, describe, expect, it } from 'vitest';
import { GET as getChromeSitemap } from '../../../src/pages/sitemap-chrome.xml.ts';
import { GET as getSitemapIndex } from '../../../src/pages/sitemap-index.xml.ts';
import { GET as getLemmaSitemap } from '../../../src/pages/sitemap-lemmas.xml.ts';

const originalLocaleUrlsLiveLangs = process.env.LOCALE_URLS_LIVE_LANGS;

afterEach(() => {
  if (originalLocaleUrlsLiveLangs === undefined) delete process.env.LOCALE_URLS_LIVE_LANGS;
  else process.env.LOCALE_URLS_LIVE_LANGS = originalLocaleUrlsLiveLangs;
});

describe('SEO sitemaps', () => {
  it('includes the lemma sitemap in the sitemap index', async () => {
    const xml = await getSitemapIndex().text();
    expect(xml).toContain('/sitemap-lemmas.xml');
  });

  it('emits standalone lemma URLs in the lemma sitemap', async () => {
    const xml = await getLemmaSitemap().text();
    expect(xml).toContain('/lemma/');
    expect(xml).toContain('<urlset');
  });

  it('emits localized informational chrome URLs and excludes english-only noindex chrome pages', async () => {
    process.env.LOCALE_URLS_LIVE_LANGS = 'hi';
    const xml = await getChromeSitemap().text();

    expect(xml).toContain('/hi/about/methodology');
    expect(xml).toContain('/hi/dataset');
    expect(xml).toContain('/hi/daily');
    expect(xml).not.toContain('/hi/search');
    expect(xml).not.toContain('/hi/unsubscribed');
  });
});
