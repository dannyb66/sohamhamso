// Regression: ISSUE-001 — VerseHit type divergence between lib + api + page
// Found by /qa on 2026-06-01
// Report: .gstack/qa-reports/qa-report-localhost-2026-06-01.md
//
// Two interfaces with the same name existed in three places:
//   src/lib/search.ts (lib)         — {verse_id, translation, source}
//   src/pages/api/search.ts (api)   — {text_id, text_title, tradition, translation_excerpt}
//   src/pages/search.astro (page)   — same as api
// A cast in loadSearchLib papered over the divergence at runtime.
// This test pins the unified contract from src/lib/search.ts so any future
// drift surfaces as a unit-test failure rather than a silent type cast.

import { describe, expect, it } from 'vitest';
import type { VerseHit } from '../../src/lib/search';

describe('ISSUE-001 — unified VerseHit shape contract', () => {
  it('VerseHit has every field both the API and the search page render', () => {
    // Compile-time shape check via a constructed object. If any required
    // field is dropped from the interface, this object literal stops compiling.
    const sample: VerseHit = {
      verse_id: 1,
      text_id: 'siva-sutras',
      text_slug: 'siva-sutras',
      text_title: 'Śiva Sūtras',
      tradition: 'trika',
      chapter: 1,
      verse_num: 1,
      devanagari: 'चैतन्यमात्मा',
      iast: 'caitanyam ātmā',
      translation_excerpt: 'Consciousness is the Self.',
      score: 0.5,
      source: 'lexical',
    };
    // Runtime sanity: all 12 fields populated, no undefined leaks.
    expect(Object.keys(sample)).toHaveLength(12);
    for (const [k, v] of Object.entries(sample)) {
      expect(v, `field "${k}" must be defined`).not.toBeUndefined();
    }
  });

  it('source field is the discriminated union from the lib (lexical|semantic|blended)', () => {
    const lexical: VerseHit['source'] = 'lexical';
    const semantic: VerseHit['source'] = 'semantic';
    const blended: VerseHit['source'] = 'blended';
    expect([lexical, semantic, blended]).toEqual(['lexical', 'semantic', 'blended']);
  });

  it('translation_excerpt is nullable (lib LIMIT 1 may return no rows)', () => {
    const withNull: VerseHit = {
      verse_id: 2,
      text_id: 'x',
      text_slug: 'x',
      text_title: 'X',
      tradition: 't',
      chapter: 1,
      verse_num: 1,
      devanagari: 'd',
      iast: null,
      translation_excerpt: null,
      score: 0,
      source: 'lexical',
    };
    expect(withNull.translation_excerpt).toBeNull();
    expect(withNull.iast).toBeNull();
  });
});
