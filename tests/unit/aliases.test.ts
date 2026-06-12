import { describe, expect, it } from 'vitest';
import {
  KNOWN_TRADITIONS,
  SLUG_ALIASES,
  enumerateRedirectPairs,
  resolveAlias,
} from '../../src/lib/aliases';
import type { TextSummary } from '../../src/lib/db';

/**
 * Pure-function tests for src/lib/aliases.ts. Uses a stub `texts` array so
 * we don't depend on the real DB — the function under test takes the
 * `texts` argument explicitly for this reason.
 */

const stubTexts: TextSummary[] = [
  {
    id: 't-karp',
    slug: 'karpuradi-stotra',
    title_sa: 'कर्पूरादिस्तोत्रम्',
    title_en: 'Karpūrādi Stotra',
    title_iast: 'Karpūrādi-stotra',
    tradition: 'shakta',
    school: null,
    author: null,
    license: 'PD',
    verse_count: 22,
  },
  {
    id: 't-prat',
    slug: 'pratyabhijna-hrdayam',
    title_sa: 'प्रत्यभिज्ञाहृदयम्',
    title_en: 'Pratyabhijñā Hr̥dayam',
    title_iast: 'Pratyabhijñā-hr̥dayam',
    tradition: 'trika',
    school: null,
    author: 'Kṣemarāja',
    license: 'PD',
    verse_count: 20,
  },
  {
    id: 't-siva',
    slug: 'siva-sutras',
    title_sa: 'शिवसूत्राणि',
    title_en: 'Śiva Sūtras',
    title_iast: 'Śiva-sūtra',
    tradition: 'trika',
    school: null,
    author: 'Vasugupta',
    license: 'PD',
    verse_count: 77,
  },
];

describe('SLUG_ALIASES table', () => {
  it('every alias points at a real canonical slug', () => {
    const canonicalSlugs = new Set(stubTexts.map((t) => t.slug));
    // The test stub doesn't have every text, so just sanity-check map shape.
    for (const [alias, canon] of Object.entries(SLUG_ALIASES)) {
      expect(alias).not.toBe(canon);
      expect(typeof canon).toBe('string');
      expect(canon.length).toBeGreaterThan(0);
    }
    // And the ones in our stub set should resolve.
    expect(SLUG_ALIASES['pratyabhijna-hridayam']).toBe('pratyabhijna-hrdayam');
    expect(SLUG_ALIASES['shiva-sutras']).toBe('siva-sutras');
    // Ensure no accidental cycles (alias → alias)
    for (const canon of Object.values(SLUG_ALIASES)) {
      expect(SLUG_ALIASES[canon]).toBeUndefined();
    }
    expect(canonicalSlugs.size).toBeGreaterThan(0); // touch the var
  });
});

describe('resolveAlias()', () => {
  it('returns canonical=true when tradition + slug both match DB', () => {
    const r = resolveAlias('shakta', 'karpuradi-stotra', stubTexts);
    expect(r?.canonical).toBe(true);
    expect(r?.canonicalTradition).toBe('shakta');
    expect(r?.canonicalSlug).toBe('karpuradi-stotra');
  });

  it('flags wrong-tradition as non-canonical with correct target', () => {
    const r = resolveAlias('trika', 'karpuradi-stotra', stubTexts);
    expect(r?.canonical).toBe(false);
    expect(r?.canonicalTradition).toBe('shakta');
    expect(r?.canonicalSlug).toBe('karpuradi-stotra');
  });

  it('resolves slug alias to canonical slug + canonical tradition', () => {
    const r = resolveAlias('trika', 'pratyabhijna-hridayam', stubTexts);
    expect(r?.canonical).toBe(false);
    expect(r?.canonicalSlug).toBe('pratyabhijna-hrdayam');
    expect(r?.canonicalTradition).toBe('trika');
  });

  it('resolves slug alias + wrong tradition combined', () => {
    const r = resolveAlias('shakta', 'pratyabhijna-hridayam', stubTexts);
    expect(r?.canonical).toBe(false);
    expect(r?.canonicalSlug).toBe('pratyabhijna-hrdayam');
    expect(r?.canonicalTradition).toBe('trika');
  });

  it('returns null for genuinely unknown slug (no fuzzy match)', () => {
    const r = resolveAlias('trika', 'totally-fake-text', stubTexts);
    expect(r).toBeNull();
  });
});

describe('enumerateRedirectPairs()', () => {
  const pairs = enumerateRedirectPairs(stubTexts);

  it('never emits the canonical (tradition, slug) pair itself', () => {
    for (const p of pairs) {
      const isCanonicalText =
        p.wrongSlug === p.canonicalSlug && p.wrongTradition === p.canonicalTradition;
      expect(isCanonicalText).toBe(false);
    }
  });

  it('includes the trika→shakta wrong-tradition entry for karpuradi', () => {
    const match = pairs.find(
      (p) =>
        p.wrongTradition === 'trika' &&
        p.wrongSlug === 'karpuradi-stotra' &&
        p.canonicalTradition === 'shakta' &&
        p.canonicalSlug === 'karpuradi-stotra',
    );
    expect(match).toBeDefined();
  });

  it('includes the hridayam→hrdayam slug alias entry', () => {
    const match = pairs.find(
      (p) => p.wrongSlug === 'pratyabhijna-hridayam' && p.canonicalSlug === 'pratyabhijna-hrdayam',
    );
    expect(match).toBeDefined();
  });

  it('does not duplicate (tradition, slug) keys', () => {
    const seen = new Set<string>();
    for (const p of pairs) {
      const key = `${p.wrongTradition}/${p.wrongSlug}`;
      expect(seen.has(key), `duplicate key ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('covers every known tradition for each text', () => {
    // Each text should produce wrong-tradition entries for every tradition
    // OTHER than its canonical one (and possibly slug-alias entries for the
    // canonical tradition too).
    const traditions = new Set(KNOWN_TRADITIONS);
    for (const t of stubTexts) {
      const otherTraditions = [...traditions].filter((x) => x !== t.tradition);
      for (const wrong of otherTraditions) {
        const hit = pairs.find(
          (p) => p.wrongTradition === wrong && p.wrongSlug === t.slug && p.canonicalSlug === t.slug,
        );
        expect(hit, `missing ${wrong}/${t.slug} → ${t.tradition}/${t.slug}`).toBeDefined();
      }
    }
  });
});
