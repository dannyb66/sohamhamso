import { afterEach, describe, expect, it } from 'vitest';
import { ALL_LANGS, liveLocaleSet } from '../../../src/lib/seo';

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
