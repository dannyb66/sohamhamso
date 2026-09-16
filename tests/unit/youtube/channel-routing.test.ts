/**
 * channel-routing.test.ts
 *
 * The per-language channel contracts: `getChannelHandle` (config → which
 * channel a lang uploads to) and `getYoutubeOAuth(lang)` (env → which
 * channel's OAuth refresh token). These are the load-bearing routing
 * decisions for the 12-channel architecture.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getChannelHandle, loadYoutubeConfig } from '../../../pipeline/youtube/config';
import { getYoutubeOAuth } from '../../../pipeline/youtube/secrets';

describe('getChannelHandle — per-language channel routing', () => {
  const cfg = loadYoutubeConfig();

  it('returns the per-language channel handle', () => {
    expect(getChannelHandle(cfg, 'en')).toBe('@sohamhamso');
    expect(getChannelHandle(cfg, 'hi')).toBe('@sohamhamso-hi');
    expect(getChannelHandle(cfg, 'or')).toBe('@sohamhamso-or');
  });

  it('falls back to defaults.channel_handle for an unmapped lang', () => {
    expect(getChannelHandle(cfg, 'zz')).toBe(cfg.defaults.channel_handle);
  });
});

describe('getYoutubeOAuth — per-channel refresh-token resolution', () => {
  const KEYS = [
    'MOCK_ALL',
    'CI',
    'NODE_ENV',
    'YOUTUBE_OAUTH_CLIENT_ID',
    'YOUTUBE_OAUTH_CLIENT_SECRET',
    'YT_REFRESH_TOKEN',
    'YT_REFRESH_TOKEN_HI',
  ];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of KEYS) saved[k] = process.env[k];
    // Exercise the real resolution path: not mock, not prod, all creds present.
    delete process.env.MOCK_ALL;
    delete process.env.CI;
    process.env.NODE_ENV = 'test';
    process.env.YOUTUBE_OAUTH_CLIENT_ID = 'cid';
    process.env.YOUTUBE_OAUTH_CLIENT_SECRET = 'csec';
    process.env.YT_REFRESH_TOKEN = 'tok-legacy';
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('prefers YT_REFRESH_TOKEN_<LANG> for a given lang', () => {
    process.env.YT_REFRESH_TOKEN_HI = 'tok-hi';
    expect(getYoutubeOAuth('hi').refreshToken).toBe('tok-hi');
  });

  it('falls back to the legacy YT_REFRESH_TOKEN when the per-lang token is absent', () => {
    delete process.env.YT_REFRESH_TOKEN_HI;
    expect(getYoutubeOAuth('hi').refreshToken).toBe('tok-legacy');
    expect(getYoutubeOAuth().refreshToken).toBe('tok-legacy');
  });
});
