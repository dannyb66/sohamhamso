import { describe, expect, it } from 'vitest';
import {
  LOCALE_PREFIXES,
  derivePageContext,
  isValidMeasurementId,
  parseConsent,
} from '../../src/lib/analytics';
import { NON_ENGLISH_LANGS } from '../../src/lib/seo';

describe('isValidMeasurementId', () => {
  it('accepts GA4 web-stream IDs', () => {
    expect(isValidMeasurementId('G-ABC123XYZ9')).toBe(true);
  });

  it.each([
    undefined,
    null,
    '',
    'UA-12345-1',
    'g-abc123',
    'G-',
    'G-abc123',
    'G-ABC123"><script>',
    ' G-ABC123',
    'GTM-ABC123',
  ])('rejects %j', (value) => {
    expect(isValidMeasurementId(value)).toBe(false);
  });
});

describe('parseConsent', () => {
  it('round-trips the two stored values', () => {
    expect(parseConsent('granted')).toBe('granted');
    expect(parseConsent('denied')).toBe('denied');
  });

  it('treats anything else as "not chosen yet"', () => {
    expect(parseConsent(null)).toBeNull();
    expect(parseConsent(undefined)).toBeNull();
    expect(parseConsent('yes')).toBeNull();
    expect(parseConsent('')).toBeNull();
  });
});

describe('LOCALE_PREFIXES', () => {
  it('matches the router locales (minus unprefixed en)', () => {
    expect([...LOCALE_PREFIXES].sort()).toEqual([...NON_ENGLISH_LANGS].sort());
  });
});

describe('derivePageContext', () => {
  it('classifies home with and without a locale prefix', () => {
    expect(derivePageContext('/')).toEqual({ content_group: 'home' });
    expect(derivePageContext('/hi')).toEqual({ content_group: 'home' });
    expect(derivePageContext('/ta/')).toEqual({ content_group: 'home' });
  });

  it('classifies chrome pages by their first segment', () => {
    expect(derivePageContext('/about/privacy')).toEqual({ content_group: 'about' });
    expect(derivePageContext('/bn/texts')).toEqual({ content_group: 'texts' });
    expect(derivePageContext('/search')).toEqual({ content_group: 'search' });
    expect(derivePageContext('/mr/lemma/siva')).toEqual({ content_group: 'lemma' });
  });

  it('extracts tradition and text on reader pages', () => {
    expect(derivePageContext('/trika/siva-sutras/1/1')).toEqual({
      content_group: 'reader',
      tradition: 'trika',
      text_slug: 'siva-sutras',
    });
    expect(derivePageContext('/hi/trika/siva-sutras/')).toEqual({
      content_group: 'reader',
      tradition: 'trika',
      text_slug: 'siva-sutras',
    });
    expect(derivePageContext('/kaula')).toEqual({ content_group: 'reader', tradition: 'kaula' });
  });
});
