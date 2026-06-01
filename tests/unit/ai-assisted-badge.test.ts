/**
 * Unit tests for the AIAssistedBadge state matrix.
 *
 * The Astro component (`src/components/AIAssistedBadge.astro`) defers its
 * state resolution to the pure helper `computeBadgeState` in
 * `src/lib/ai-badge-state.ts` — so we exercise the matrix here without
 * needing an Astro renderer. The component itself just spreads
 * {variant, label, icon} into the DOM and aria-label.
 *
 * State matrix under test (locked by design):
 *
 *   | aiAssisted | status     | variant  | icon | label                          |
 *   |------------|------------|----------|------|--------------------------------|
 *   | true       | reviewed   | emerald  | ✓    | "AI · reviewed by {name}"     |
 *   | true       | reviewed*  | emerald  | ✓    | "AI · reviewed"  (no name)    |
 *   | true       | published  | amber    | AI   | "AI · not verified"           |
 *   | true       | draft      | amber    | AI   | "AI · not verified"  (fbk)    |
 *   | false      | *          | slate    | PD   | "{translator} · {year} · PD"  |
 *   | false      | *          | slate    | PD   | "Public domain"  (no fields)  |
 *
 * Run with: `bun --bun vitest run tests/unit/ai-assisted-badge.test.ts`
 */
import { describe, expect, it } from 'vitest';
import { computeBadgeState } from '../../src/lib/ai-badge-state';

describe('computeBadgeState() — emerald (AI + reviewed)', () => {
  it("renders 'reviewed by {name}' when a reviewer is supplied", () => {
    const s = computeBadgeState({
      aiAssisted: true,
      status: 'reviewed',
      reviewerName: 'Daniel Smith',
    });
    expect(s.variant).toBe('emerald');
    expect(s.icon).toBe('✓');
    expect(s.label).toBe('AI · reviewed by Daniel Smith');
  });

  it("falls back to 'AI · reviewed' when reviewerName is absent", () => {
    const s = computeBadgeState({
      aiAssisted: true,
      status: 'reviewed',
    });
    expect(s.variant).toBe('emerald');
    expect(s.icon).toBe('✓');
    expect(s.label).toBe('AI · reviewed');
  });

  it("falls back to 'AI · reviewed' when reviewerName is null", () => {
    const s = computeBadgeState({
      aiAssisted: true,
      status: 'reviewed',
      reviewerName: null,
    });
    expect(s.label).toBe('AI · reviewed');
  });

  it('ignores translator + year when emerald (AI provenance dominates)', () => {
    const s = computeBadgeState({
      aiAssisted: true,
      status: 'reviewed',
      reviewerName: 'R',
      translator: 'Some Person',
      year: 1922,
    });
    // Emerald label only encodes AI + reviewer; translator/year live in
    // the disclosure body, not on the pill.
    expect(s.label).toBe('AI · reviewed by R');
    expect(s.label).not.toContain('Some Person');
    expect(s.label).not.toContain('1922');
  });
});

describe('computeBadgeState() — amber (AI + not-yet-reviewed)', () => {
  it("renders 'AI · not verified' for status='published'", () => {
    const s = computeBadgeState({
      aiAssisted: true,
      status: 'published',
    });
    expect(s.variant).toBe('amber');
    expect(s.icon).toBe('AI');
    expect(s.label).toBe('AI · not verified');
  });

  it("falls back to amber for status='draft' (defensive — drafts should not surface, but if they do, they MUST NOT pose as PD)", () => {
    const s = computeBadgeState({
      aiAssisted: true,
      status: 'draft',
    });
    expect(s.variant).toBe('amber');
    expect(s.label).toBe('AI · not verified');
  });

  it('ignores reviewerName on amber (status, not reviewer, gates the emerald upgrade)', () => {
    const s = computeBadgeState({
      aiAssisted: true,
      status: 'published',
      reviewerName: 'Daniel Smith',
    });
    expect(s.variant).toBe('amber');
    expect(s.label).toBe('AI · not verified');
  });
});

describe('computeBadgeState() — slate (public-domain / human translation)', () => {
  it("renders '{translator} · {year} · PD' for a classic PD translation", () => {
    const s = computeBadgeState({
      aiAssisted: false,
      status: 'published',
      translator: 'Woodroffe',
      year: 1922,
    });
    expect(s.variant).toBe('slate');
    expect(s.icon).toBe('PD');
    expect(s.label).toBe('Woodroffe · 1922 · PD');
  });

  it("does NOT append ' · PD' when the translator string already encodes PD", () => {
    const s = computeBadgeState({
      aiAssisted: false,
      status: 'published',
      translator: 'Public domain',
    });
    expect(s.variant).toBe('slate');
    expect(s.label).toBe('Public domain');
    // No double-PD suffix
    expect(s.label).not.toMatch(/PD.*PD/);
    expect(s.label.endsWith('· PD')).toBe(false);
  });

  it("does NOT append ' · PD' for 'public-domain' (hyphenated, case-insensitive)", () => {
    const s = computeBadgeState({
      aiAssisted: false,
      status: 'published',
      translator: 'public-domain composite',
    });
    expect(s.label).toBe('public-domain composite');
    expect(s.label).not.toMatch(/PD\s*·\s*PD/);
  });

  it("does NOT append ' · PD' when the translator string contains a bare 'PD' token", () => {
    const s = computeBadgeState({
      aiAssisted: false,
      status: 'published',
      translator: 'PD',
    });
    expect(s.label).toBe('PD');
  });

  it("DOES append ' · PD' when the translator string only mentions a name (no PD marker)", () => {
    const s = computeBadgeState({
      aiAssisted: false,
      status: 'published',
      translator: 'Some Translator',
    });
    expect(s.label).toBe('Some Translator · PD');
  });

  it("falls back to 'Public domain' when translator is null/empty", () => {
    expect(computeBadgeState({ aiAssisted: false, status: 'published' }).label).toBe(
      'Public domain',
    );
    expect(
      computeBadgeState({
        aiAssisted: false,
        status: 'published',
        translator: null,
      }).label,
    ).toBe('Public domain');
    expect(
      computeBadgeState({
        aiAssisted: false,
        status: 'published',
        translator: '   ',
      }).label,
    ).toBe('Public domain');
  });

  it('omits year cleanly when not supplied', () => {
    const s = computeBadgeState({
      aiAssisted: false,
      status: 'published',
      translator: 'Woodroffe',
    });
    expect(s.label).toBe('Woodroffe · PD');
    expect(s.label).not.toContain('undefined');
    expect(s.label).not.toContain('null');
  });

  it('accepts string year as well as number', () => {
    const s = computeBadgeState({
      aiAssisted: false,
      status: 'published',
      translator: 'Woodroffe',
      year: '1922',
    });
    expect(s.label).toBe('Woodroffe · 1922 · PD');
  });

  it("works for non-AI even when status would otherwise be 'reviewed' (false dominates)", () => {
    // aiAssisted=false should ALWAYS take the slate path regardless of status.
    const s = computeBadgeState({
      aiAssisted: false,
      status: 'reviewed',
      translator: 'Woodroffe',
      year: 1922,
    });
    expect(s.variant).toBe('slate');
    expect(s.label).toBe('Woodroffe · 1922 · PD');
  });
});

describe('computeBadgeState() — invariants', () => {
  it("never returns a label containing 'undefined' or 'null'", () => {
    const inputs = [
      { aiAssisted: true, status: 'reviewed' as const },
      { aiAssisted: true, status: 'published' as const },
      { aiAssisted: true, status: 'draft' as const },
      { aiAssisted: false, status: 'published' as const },
      { aiAssisted: false, status: 'published' as const, translator: null },
      {
        aiAssisted: false,
        status: 'published' as const,
        translator: 'X',
        year: null,
      },
    ];
    for (const inp of inputs) {
      const s = computeBadgeState(inp);
      expect(s.label).not.toMatch(/undefined|null/i);
    }
  });

  it('always returns one of the three known variants', () => {
    const variants = new Set(['amber', 'emerald', 'slate']);
    const cases = [
      { aiAssisted: true, status: 'reviewed' as const },
      { aiAssisted: true, status: 'published' as const },
      { aiAssisted: true, status: 'draft' as const },
      { aiAssisted: false, status: 'reviewed' as const },
      { aiAssisted: false, status: 'published' as const },
      { aiAssisted: false, status: 'draft' as const },
    ];
    for (const inp of cases) {
      expect(variants.has(computeBadgeState(inp).variant)).toBe(true);
    }
  });

  it('variant ↔ icon are consistent across the matrix', () => {
    const iconByVariant: Record<string, string> = {
      emerald: '✓',
      amber: 'AI',
      slate: 'PD',
    };
    const cases = [
      { aiAssisted: true, status: 'reviewed' as const },
      { aiAssisted: true, status: 'published' as const },
      { aiAssisted: false, status: 'published' as const, translator: 'X' },
    ];
    for (const inp of cases) {
      const s = computeBadgeState(inp);
      expect(s.icon).toBe(iconByVariant[s.variant]);
    }
  });
});
