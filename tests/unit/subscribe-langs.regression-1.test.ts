// Regression: ISSUE-007 — SubscribeBand offered all 12 langs as enabled,
// but POST /api/subscribe rejected everything except 'en' with HTTP 400.
// Surfaced by /qa on 2026-06-01.
// Report: .gstack/qa-reports/qa-report-localhost-2026-06-01-pass2.md
//
// Root cause: SubscribeBand sourced its availability flag from
// getAvailableLanguages() (the corpus DB's published-language set —
// all 12 lit up because every text has all 12 translations), but the
// daily-verse API has its OWN allowlist (V1: English only). The two
// drifted apart silently because nothing pinned them to a shared source.
//
// Fix: src/lib/subscribe-langs.ts exports ACTIVE_LANGUAGES as the
// canonical V1 allowlist. Both src/pages/api/subscribe.ts AND
// src/components/SubscribeBand.astro import from there. This test pins
// the contract so a future drop-of-a-language to the API's allowlist
// cannot ship without the picker auto-updating (or vice versa).

import { describe, expect, it } from 'vitest';
import { ACTIVE_LANGUAGES, KNOWN_LANGUAGES } from '../../src/lib/subscribe-langs';

describe('ISSUE-007 — subscribe lang allowlist is single source of truth', () => {
  it('ACTIVE_LANGUAGES at V1 is English-only', () => {
    expect(ACTIVE_LANGUAGES.has('en')).toBe(true);
    expect(ACTIVE_LANGUAGES.size).toBe(1);
  });

  it('ACTIVE_LANGUAGES is a subset of KNOWN_LANGUAGES', () => {
    for (const lang of ACTIVE_LANGUAGES) {
      expect(KNOWN_LANGUAGES.has(lang), `${lang} must be in KNOWN_LANGUAGES`).toBe(true);
    }
  });

  it('KNOWN_LANGUAGES covers all 12 corpus languages (the reader-side superset)', () => {
    const expected = ['en', 'hi', 'ta', 'te', 'bn', 'mr', 'gu', 'kn', 'ml', 'pa', 'or', 'as'];
    expect(KNOWN_LANGUAGES.size).toBe(expected.length);
    for (const lang of expected) {
      expect(KNOWN_LANGUAGES.has(lang), `${lang} must be in KNOWN_LANGUAGES`).toBe(true);
    }
  });

  it('non-active languages must be rejected (V1 contract): hi/ta/te all not in ACTIVE_LANGUAGES', () => {
    // If this assertion breaks because a new language was made active,
    // remove it from this list AND update the V1-only assertion above.
    expect(ACTIVE_LANGUAGES.has('hi')).toBe(false);
    expect(ACTIVE_LANGUAGES.has('ta')).toBe(false);
    expect(ACTIVE_LANGUAGES.has('te')).toBe(false);
  });
});
