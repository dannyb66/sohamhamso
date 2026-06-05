import { describe, expect, it } from 'vitest';
import { enumerateRedirectPairs } from '../../src/lib/aliases';
import type { TextSummary } from '../../src/lib/db';
import {
  NON_ENGLISH_LOCALES,
  buildRedirectRules,
  buildRedirectsPayload,
} from '../../scripts/seo-build-redirects';

const stubTexts: TextSummary[] = [
  {
    id: 't-karp',
    slug: 'karpuradi-stotra',
    title_sa: 'कर्पूरादिस्तोत्रम्',
    title_en: 'Karpūrādi Stotra',
    title_iast: 'Karpūrādi-stotra',
    tradition: 'shakta',
    school: null,
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
    verse_count: 20,
  },
];

describe('seo-build-redirects', () => {
  const pairs = enumerateRedirectPairs(stubTexts);
  const rules = buildRedirectRules(pairs);
  const payload = buildRedirectsPayload(pairs);
  const lines = payload.trim().split('\n');

  it('emits exact + wildcard redirect coverage for every alias pair at root and every non-English locale', () => {
    for (const pair of pairs) {
      expect(lines).toContain(
        `/${pair.wrongTradition}/${pair.wrongSlug} /${pair.canonicalTradition}/${pair.canonicalSlug} 301`,
      );
      expect(lines).toContain(
        `/${pair.wrongTradition}/${pair.wrongSlug}/* /${pair.canonicalTradition}/${pair.canonicalSlug}/:splat 301`,
      );

      for (const locale of NON_ENGLISH_LOCALES) {
        expect(lines).toContain(
          `/${locale}/${pair.wrongTradition}/${pair.wrongSlug} /${locale}/${pair.canonicalTradition}/${pair.canonicalSlug} 301`,
        );
        expect(lines).toContain(
          `/${locale}/${pair.wrongTradition}/${pair.wrongSlug}/* /${locale}/${pair.canonicalTradition}/${pair.canonicalSlug}/:splat 301`,
        );
      }
    }
  });

  it('does not generate /en-prefixed locale rules', () => {
    expect(lines.some((line) => line.startsWith('/en/'))).toBe(false);
  });

  it('does not emit duplicate rules or duplicate serialized lines', () => {
    expect(new Set(lines).size).toBe(lines.length);
    expect(new Set(rules.map((rule) => `${rule.from} ${rule.to} ${rule.status}`)).size).toBe(
      rules.length,
    );
  });

  it('matches the expected rule count from pair parity', () => {
    const rulesPerPair = 2 + NON_ENGLISH_LOCALES.length * 2;
    expect(rules).toHaveLength(pairs.length * rulesPerPair);
    expect(lines).toHaveLength(pairs.length * rulesPerPair);
  });

  it('ends with a trailing newline for Cloudflare _redirects output', () => {
    expect(payload.endsWith('\n')).toBe(true);
  });
});
