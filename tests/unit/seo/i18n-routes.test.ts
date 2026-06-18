import { afterEach, describe, expect, it } from 'vitest';
import {
  ALL_LANGS,
  absoluteChapterIndexUrl,
  chapterIndexPath,
  liveLocaleSet,
  localePathFor,
} from '../../../src/lib/seo';

const originalLocaleUrlsLive = process.env.LOCALE_URLS_LIVE;
const originalLocaleUrlsLiveLangs = process.env.LOCALE_URLS_LIVE_LANGS;

describe('liveLocaleSet', () => {
  afterEach(() => {
    if (originalLocaleUrlsLive === undefined) delete process.env.LOCALE_URLS_LIVE;
    else process.env.LOCALE_URLS_LIVE = originalLocaleUrlsLive;

    if (originalLocaleUrlsLiveLangs === undefined) delete process.env.LOCALE_URLS_LIVE_LANGS;
    else process.env.LOCALE_URLS_LIVE_LANGS = originalLocaleUrlsLiveLangs;
  });

  it('defaults to english-only rollout', () => {
    delete process.env.LOCALE_URLS_LIVE;
    delete process.env.LOCALE_URLS_LIVE_LANGS;

    expect(Array.from(liveLocaleSet())).toEqual(['en']);
  });

  it('allows an explicit locale allowlist and always keeps english live', () => {
    delete process.env.LOCALE_URLS_LIVE;
    process.env.LOCALE_URLS_LIVE_LANGS = 'ta,hi';

    expect(Array.from(liveLocaleSet()).sort()).toEqual(['en', 'hi', 'ta']);
  });

  it('enables every locale when LOCALE_URLS_LIVE is true', () => {
    process.env.LOCALE_URLS_LIVE = 'true';
    delete process.env.LOCALE_URLS_LIVE_LANGS;

    expect(Array.from(liveLocaleSet()).sort()).toEqual([...ALL_LANGS].sort());
  });
});

describe('chapterIndexPath', () => {
  const base = '/trika/sivadrsti/1';

  it('keeps the English (canonical) chapter-index path slash-free', () => {
    // The canonical 3-segment path is not worker-shadowed; it must stay bare
    // so it matches localePathFor and the global trailingSlash:"never".
    expect(chapterIndexPath(base, 'en')).toBe('/trika/sivadrsti/1');
    expect(chapterIndexPath(base, 'en')).toBe(localePathFor(base, 'en'));
  });

  it('appends a trailing slash to localized chapter-index paths', () => {
    // The bare localized URL 404s on CF Pages (SSR verse worker shadows it);
    // only the trailing-slash form serves the static asset.
    expect(chapterIndexPath(base, 'hi')).toBe('/hi/trika/sivadrsti/1/');
    expect(chapterIndexPath(base, 'as')).toBe('/as/trika/sivadrsti/1/');
  });

  it('differs from localePathFor exactly by the trailing slash for non-English', () => {
    for (const lang of ALL_LANGS) {
      const expected = lang === 'en' ? localePathFor(base, lang) : `${localePathFor(base, lang)}/`;
      expect(chapterIndexPath(base, lang)).toBe(expected);
    }
  });

  it('builds an absolute URL with the same slash discipline', () => {
    expect(absoluteChapterIndexUrl(base, 'en')).toBe('https://sohamhamso.org/trika/sivadrsti/1');
    expect(absoluteChapterIndexUrl(base, 'hi')).toBe('https://sohamhamso.org/hi/trika/sivadrsti/1/');
  });
});
