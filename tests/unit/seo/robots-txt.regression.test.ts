import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildRobotsTxt, GET } from '../../../src/pages/robots.txt.ts';

const originalLocaleUrlsLive = process.env.LOCALE_URLS_LIVE;
const originalLocaleUrlsLiveLangs = process.env.LOCALE_URLS_LIVE_LANGS;

beforeEach(() => {
  delete process.env.LOCALE_URLS_LIVE;
  delete process.env.LOCALE_URLS_LIVE_LANGS;
});

afterEach(() => {
  if (originalLocaleUrlsLive === undefined) delete process.env.LOCALE_URLS_LIVE;
  else process.env.LOCALE_URLS_LIVE = originalLocaleUrlsLive;
  if (originalLocaleUrlsLiveLangs === undefined) delete process.env.LOCALE_URLS_LIVE_LANGS;
  else process.env.LOCALE_URLS_LIVE_LANGS = originalLocaleUrlsLiveLangs;
});

describe('robots.txt regression', () => {
  it('lists all five sitemaps', () => {
    const body = buildRobotsTxt();
    expect(body).toContain('Sitemap: https://sohamhamso.org/sitemap-index.xml');
    expect(body).toContain('Sitemap: https://sohamhamso.org/sitemap-verses.xml');
    expect(body).toContain('Sitemap: https://sohamhamso.org/sitemap-texts.xml');
    expect(body).toContain('Sitemap: https://sohamhamso.org/sitemap-lemmas.xml');
    expect(body).toContain('Sitemap: https://sohamhamso.org/sitemap-chrome.xml');
  });

  it('disallows non-indexable paths (/api/, /search, /og/, /confirmed, /unsubscribed)', () => {
    const body = buildRobotsTxt();
    expect(body).toContain('Disallow: /api/');
    expect(body).toContain('Disallow: /search');
    expect(body).toContain('Disallow: /og/');
    expect(body).toContain('Disallow: /confirmed');
    expect(body).toContain('Disallow: /unsubscribed');
  });

  it('disallows non-english locales when LOCALE_URLS_LIVE is unset', () => {
    const body = buildRobotsTxt();
    expect(body).toContain('Disallow: /hi/');
    expect(body).toContain('Disallow: /ta/');
  });

  it('does NOT disallow locales that are live', () => {
    process.env.LOCALE_URLS_LIVE_LANGS = 'hi';
    const body = buildRobotsTxt();
    expect(body).not.toContain('Disallow: /hi/');
    expect(body).toContain('Disallow: /ta/');
  });

  it('starts with User-agent: * directive', () => {
    const body = buildRobotsTxt();
    expect(body.split('\n')[0]).toBe('User-agent: *');
  });

  it('GET() returns text/plain response containing the robots body', async () => {
    const res = GET();
    expect(res.headers.get('Content-Type')).toContain('text/plain');
    const text = await res.text();
    expect(text).toContain('User-agent: *');
    expect(text).toContain('Sitemap: https://sohamhamso.org/sitemap-index.xml');
  });
});
