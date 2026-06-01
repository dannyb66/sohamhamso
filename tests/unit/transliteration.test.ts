// biome-ignore lint/correctness/noUndeclaredDependencies: package ships types
import Sanscript from '@indic-transliteration/sanscript';
/**
 * Unit tests for `src/lib/transliteration.ts` (thin wrapper around
 * `@indic-transliteration/sanscript`) plus direct Sanscript sanity checks.
 *
 * Run with: `bun --bun vitest run tests/unit/transliteration.test.ts`
 */
import { describe, expect, it } from 'vitest';
import { availableScripts, toScript } from '../../src/lib/transliteration';

// ─────────────────────────────────────────────────────────────────────────
// Module surface
// ─────────────────────────────────────────────────────────────────────────
describe('availableScripts', () => {
  it('exposes exactly the eleven scripts the reader supports', () => {
    expect(availableScripts).toHaveLength(11);
    const required = [
      'devanagari',
      'bengali',
      'gujarati',
      'gurmukhi',
      'kannada',
      'malayalam',
      'oriya',
      'tamil',
      'telugu',
      'iast',
      'assamese',
    ];
    for (const s of required) {
      expect(availableScripts).toContain(s);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Happy-path conversions
// ─────────────────────────────────────────────────────────────────────────
describe('toScript() — Devanāgarī ↔ IAST (Śiva Sūtra 1.1)', () => {
  // "caitanyamātmā" — Devanāgarī ↔ IAST should round-trip.
  // Note: this is a *Sanscript* round-trip, so we compare what Sanscript
  // emits going forward, then verify the reverse matches the input.
  const deva = 'चैतन्यमात्मा';

  it('Devanāgarī → IAST emits the expected transliteration', () => {
    const iast = toScript(deva, 'devanagari', 'iast');
    // Sanscript renders the conjunct ny + the final long-ā; lowercase 'c'
    // (because IAST is unicode-lowercase for consonants).
    expect(iast).toContain('caitanyam');
    expect(iast).toContain('ātmā');
  });

  it('IAST → Devanāgarī round-trips back to the source', () => {
    const iast = toScript(deva, 'devanagari', 'iast');
    const back = toScript(iast, 'iast', 'devanagari');
    expect(back).toBe(deva);
  });

  it('the data-sa-source lossless-roundtrip pattern holds (voicing-preserving scripts)', () => {
    // Tamil intentionally collapses voicing/aspiration distinctions (ka = क/ख/ग/घ),
    // so a Devanāgarī → Tamil → IAST → Devanāgarī round-trip cannot preserve
    // काइतन्य's च (it comes back as ज). This is a script-system limitation, not a
    // bug. Production code stores the original Devanāgarī in `data-sa-source`
    // precisely to handle this — the round-trip itself is only guaranteed for
    // scripts that preserve the full Sanskrit consonant inventory.
    const targets = ['telugu', 'bengali', 'gujarati', 'kannada'];
    for (const target of targets) {
      const rendered = toScript(deva, 'devanagari', target);
      const viaIast = toScript(rendered, target, 'iast');
      const reconstructed = toScript(viaIast, 'iast', 'devanagari');
      expect(reconstructed).toBe(deva);
    }
  });
});

describe('toScript() — Devanāgarī → other Brahmic scripts (sanity)', () => {
  const deva = 'चैतन्यमात्मा';

  it.each([
    ['tamil', '஀', '௿'], // Tamil block
    ['telugu', 'ఀ', '౿'], // Telugu block
    ['bengali', 'ঀ', '৿'], // Bengali block (also serves Assamese)
    ['gujarati', '઀', '૿'],
    ['kannada', 'ಀ', '೿'],
    ['malayalam', 'ഀ', 'ൿ'],
    ['gurmukhi', '਀', '੿'],
    ['oriya', '଀', '୿'],
    ['assamese', 'ঀ', '৿'], // Assamese reuses the Bengali block
  ])('converts to %s without throwing, first char in expected Unicode block', (target, lo, hi) => {
    const out = toScript(deva, 'devanagari', target);
    expect(out.length).toBeGreaterThan(0);
    const code = out.codePointAt(0)!;
    expect(code).toBeGreaterThanOrEqual(lo.codePointAt(0)!);
    expect(code).toBeLessThanOrEqual(hi.codePointAt(0)!);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Diacritic preservation
// ─────────────────────────────────────────────────────────────────────────
describe('IAST diacritics preserved through devanagari round-trip', () => {
  // Each entry is a minimal IAST string whose round-trip through devanagari
  // must come back identical. Group long-vowels separately because the
  // Sanscript output uses combining diacritics on bare consonants — we
  // need a vowel-bearing context for short ṛ ḷ etc.
  const cases: string[] = [
    'ā',
    'ī',
    'ū',
    'ṛ',
    'ṝ',
    'ḷ',
    'ṃ',
    'ḥ',
    'ṅa',
    'ña',
    'ṭa',
    'ḍa',
    'ṇa',
    'śa',
    'ṣa',
  ];

  it.each(cases)("round-trips '%s' unchanged via devanagari", (input) => {
    const deva = toScript(input, 'iast', 'devanagari');
    const back = toScript(deva, 'devanagari', 'iast');
    expect(back).toBe(input);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Error handling
// ─────────────────────────────────────────────────────────────────────────
describe('toScript() — unsupported script', () => {
  it('throws a clear error when fromScript is not in availableScripts', () => {
    expect(() => toScript('test', 'klingon', 'iast')).toThrow(
      /Unsupported source script: 'klingon'/,
    );
  });

  it('throws a clear error when toScript is not in availableScripts', () => {
    // Sanscript supports many schemes (e.g. hk, slp1) that the reader
    // intentionally does NOT expose — the wrapper should reject them.
    expect(() => toScript('test', 'devanagari', 'hk')).toThrow(/Unsupported target script: 'hk'/);
    expect(() => toScript('test', 'devanagari', 'klingon')).toThrow(/Unsupported target script/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Direct Sanscript sanity (proves the underlying library is callable
// and the wrapper isn't masking a broken dependency)
// ─────────────────────────────────────────────────────────────────────────
describe('Sanscript direct calls (dependency smoke test)', () => {
  it('exposes a callable t() function', () => {
    expect(typeof Sanscript.t).toBe('function');
  });

  it('matches the wrapper output for a known conversion', () => {
    const deva = 'चैतन्यमात्मा';
    expect(Sanscript.t(deva, 'devanagari', 'iast')).toBe(toScript(deva, 'devanagari', 'iast'));
  });
});
