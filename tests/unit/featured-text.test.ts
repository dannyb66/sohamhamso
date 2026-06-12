// Unit tests for the self-expiring launch-feature line's pure logic
// (src/lib/featured-text.ts). The FeaturedNewText.astro component renders
// nothing unless shouldFeature() is true, so these tests pin the entire
// show/hide contract: empty config, malformed dates, and the expiry
// boundary all read as "render nothing" — a stale "New" can never rot
// on the homepage.

import { describe, expect, it } from 'vitest';
import {
  FEATURED_TEXT,
  type FeaturedTextConfig,
  featuredCopy,
  shouldFeature,
} from '../../src/lib/featured-text';

const NOW = new Date('2026-06-10T12:00:00Z');

function config(overrides: Partial<FeaturedTextConfig> = {}): FeaturedTextConfig {
  return {
    slug: 'trika/vijnana-bhairava-tantra',
    featured_until: '2026-08-01T00:00:00Z',
    locales: {
      en: { title: 'Vijñāna Bhairava Tantra', descriptor: '112 dhāraṇās' },
      hi: { title: 'विज्ञान भैरव तंत्र', descriptor: '112 धारणाएँ' },
    },
    ...overrides,
  };
}

describe('shouldFeature — expiry logic', () => {
  it('returns false for null / undefined config (V1 empty-config state)', () => {
    expect(shouldFeature(null, NOW)).toBe(false);
    expect(shouldFeature(undefined, NOW)).toBe(false);
  });

  it('returns false when slug or featured_until is blank', () => {
    expect(shouldFeature(config({ slug: '' }), NOW)).toBe(false);
    expect(shouldFeature(config({ featured_until: '' }), NOW)).toBe(false);
  });

  it('returns false for an unparseable featured_until (fail quiet, never throw)', () => {
    expect(shouldFeature(config({ featured_until: 'not-a-date' }), NOW)).toBe(false);
  });

  it('returns true while now is strictly before featured_until', () => {
    expect(shouldFeature(config(), NOW)).toBe(true);
    expect(shouldFeature(config({ featured_until: '2026-06-10T12:00:01Z' }), NOW)).toBe(true);
  });

  it('returns false once featured_until has passed', () => {
    expect(shouldFeature(config({ featured_until: '2026-06-01T00:00:00Z' }), NOW)).toBe(false);
  });

  it('expires AT the boundary instant (strict <, so now === until hides the line)', () => {
    expect(shouldFeature(config({ featured_until: '2026-06-10T12:00:00Z' }), NOW)).toBe(false);
  });

  it('treats a date-only featured_until as 00:00 UTC of that day', () => {
    // '2026-06-10' parses as 2026-06-10T00:00:00Z — already past at NOW
    // (12:00 UTC the same day). Documented in FeaturedTextConfig: use a
    // full datetime for end-of-day semantics.
    expect(shouldFeature(config({ featured_until: '2026-06-10' }), NOW)).toBe(false);
    expect(shouldFeature(config({ featured_until: '2026-06-11' }), NOW)).toBe(true);
  });
});

describe('featuredCopy — per-locale resolution', () => {
  it('returns the exact locale match when present', () => {
    expect(featuredCopy(config(), 'hi')?.title).toBe('विज्ञान भैरव तंत्र');
  });

  it('falls back to en for a locale without dedicated copy', () => {
    expect(featuredCopy(config(), 'ta')?.title).toBe('Vijñāna Bhairava Tantra');
  });

  it('returns null when even en is missing (malformed config fails quiet)', () => {
    expect(featuredCopy(config({ locales: {} }), 'en')).toBeNull();
  });
});

describe('FEATURED_TEXT — shipped launch state', () => {
  // V1 ships with NO featured text; Wave 1's launch beat fills the
  // config. Update this expectation when it does.
  it('ships empty (null) so the homepage renders no "New" line', () => {
    expect(FEATURED_TEXT).toBeNull();
    expect(shouldFeature(FEATURED_TEXT, NOW)).toBe(false);
  });
});
