import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load as yamlLoad } from 'js-yaml';
/**
 * Prose render branch (plan A4 render side).
 *
 * Like tests/unit/seo/breadcrumbs.test.ts, this project's vitest config
 * cannot render .astro files, so the contract is pinned in two layers —
 * both load-bearing:
 *
 *  1. Pure-helper tests on src/lib/prose.ts (the exact functions
 *     VerseAnatomy.astro imports and calls per render mode). The BINDING
 *     verification from the plan lives here: a prose fixture's rendered
 *     HTML must have <= 0 line breaks per block — prose BYPASSES
 *     formatDanda and is never shredded into per-danda lines.
 *  2. Raw-source regex assertions on VerseAnatomy.astro, both verse
 *     pages, both text-overview pages and the i18n dictionaries to pin
 *     the wiring (explicit prose branch, collapsed IAST <details>, no
 *     synonyms region, isShortVerse guard, label switches).
 *
 * Run with: `bun --bun vitest run tests/unit/prose-render.test.ts`
 */
import { describe, expect, it } from 'vitest';
import {
  computeIsShortVerse,
  formatDanda,
  isProseSection,
  splitProseParagraphs,
} from '../../src/lib/prose';
import { CorpusVerseSchema } from '../../src/lib/seo/corpus-schema';

const ROOT = resolve(__dirname, '..', '..');
const FIXTURE_PATH = resolve(ROOT, 'tests', 'fixtures', 'prose-corpus.yaml');

type FixtureVerse = {
  verse_num: number;
  devanagari: string;
  iast: string | null;
  section_type?: string;
  prose_block_ref?: string;
  translations?: Array<{ lang: string; translation_text: string }>;
};

const corpus = yamlLoad(readFileSync(FIXTURE_PATH, 'utf8')) as {
  chapters: Array<{ chapter: number; verses: FixtureVerse[] }>;
};
const verses = corpus.chapters[0]?.verses ?? [];
const sutra = verses[0] as FixtureVerse;
const proseBlock = verses[1] as FixtureVerse;

/**
 * Mirror of VerseAnatomy's prose branch: splitProseParagraphs feeds one
 * <p> per paragraph (white-space: normal — formatDanda never touches the
 * prose path).
 */
function renderProseHtml(s: string | null | undefined): string {
  return splitProseParagraphs(s)
    .map((p) => `<p>${p}</p>`)
    .join('');
}

function countLineBreaks(s: string): number {
  return (s.match(/\n/g) ?? []).length;
}

function readSource(...segments: string[]): string {
  return readFileSync(resolve(ROOT, ...segments), 'utf8');
}

// ---------------------------------------------------------------
// Fixture sanity — stays valid against the real corpus schema
// ---------------------------------------------------------------

describe('prose fixture (tests/fixtures/prose-corpus.yaml)', () => {
  it('parses both blocks against CorpusVerseSchema', () => {
    expect(CorpusVerseSchema.parse(sutra).section_type).toBe('verse');
    const parsed = CorpusVerseSchema.parse(proseBlock);
    expect(parsed.section_type).toBe('prose');
    expect(parsed.prose_block_ref).toBe('vrtti-1.1');
  });

  it('carries multiple dandas per paragraph plus one blank-line break', () => {
    expect((proseBlock.devanagari.match(/।/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect(proseBlock.devanagari).toMatch(/\n\n/);
  });
});

// ---------------------------------------------------------------
// 1. BINDING: prose bypasses formatDanda — no danda-shredding
// ---------------------------------------------------------------

describe('prose render path — danda-shredding guard', () => {
  it('renders the prose Devanāgarī with 0 line breaks per block', () => {
    const html = renderProseHtml(proseBlock.devanagari);
    expect(html).toContain('<p>');
    expect(countLineBreaks(html)).toBe(0);
    for (const para of splitProseParagraphs(proseBlock.devanagari)) {
      expect(countLineBreaks(para)).toBe(0);
    }
  });

  it('renders the prose IAST with 0 line breaks per block', () => {
    const html = renderProseHtml(proseBlock.iast);
    expect(countLineBreaks(html)).toBe(0);
  });

  it('would have been shredded by formatDanda — the bypass is load-bearing', () => {
    // The verse path splits on every danda; on this prose block that
    // produces a fake-verse line stack. The prose path must not.
    expect(countLineBreaks(formatDanda(proseBlock.devanagari))).toBeGreaterThanOrEqual(6);
    expect(countLineBreaks(formatDanda(proseBlock.iast))).toBeGreaterThanOrEqual(6);
  });

  it('keeps every danda (no content loss) and the blank-line paragraph break', () => {
    const paras = splitProseParagraphs(proseBlock.devanagari);
    expect(paras).toHaveLength(2);
    const joined = paras.join(' ');
    expect((joined.match(/।/g) ?? []).length).toBe(
      (proseBlock.devanagari.match(/।/g) ?? []).length,
    );
  });

  it('leaves the verse path untouched: sūtra keeps its ॥N॥ bracket attached', () => {
    const formatted = formatDanda(sutra.devanagari);
    expect(formatted).toContain('॥१॥');
    expect(countLineBreaks(formatted)).toBe(0);
  });
});

// ---------------------------------------------------------------
// 2. Multi-paragraph prose translations
// ---------------------------------------------------------------

describe('prose translations with blank-line paragraph breaks', () => {
  it('renders one <p> per paragraph', () => {
    const text = proseBlock.translations?.[0]?.translation_text ?? '';
    const paras = splitProseParagraphs(text);
    expect(paras).toHaveLength(2);
    const html = renderProseHtml(text);
    expect((html.match(/<p>/g) ?? []).length).toBe(2);
    expect(countLineBreaks(html)).toBe(0);
  });

  it('treats single newlines as flowing whitespace, not paragraph breaks', () => {
    expect(splitProseParagraphs('one\ntwo\n\nthree')).toEqual(['one two', 'three']);
  });

  it('handles null/empty input', () => {
    expect(splitProseParagraphs(null)).toEqual([]);
    expect(splitProseParagraphs('')).toEqual([]);
    expect(splitProseParagraphs('\n\n')).toEqual([]);
  });
});

// ---------------------------------------------------------------
// 3. isShortVerse guard — must not fire for prose blocks
// ---------------------------------------------------------------

describe('computeIsShortVerse', () => {
  it('never fires for prose blocks (prose is never a short verse)', () => {
    expect(
      computeIsShortVerse({ sectionType: 'prose', translationLength: 800, glossCount: 0 }),
    ).toBe(false);
    expect(
      computeIsShortVerse({ sectionType: 'prose', translationLength: 12, glossCount: 0 }),
    ).toBe(false);
  });

  it('keeps the existing heuristic for verses', () => {
    expect(
      computeIsShortVerse({ sectionType: 'verse', translationLength: 800, glossCount: 0 }),
    ).toBe(true);
    expect(
      computeIsShortVerse({ sectionType: 'verse', translationLength: 12, glossCount: 9 }),
    ).toBe(true);
    expect(
      computeIsShortVerse({ sectionType: 'verse', translationLength: 800, glossCount: 9 }),
    ).toBe(false);
    // legacy rows with null/undefined section_type behave as verses
    expect(computeIsShortVerse({ sectionType: null, translationLength: 800, glossCount: 0 })).toBe(
      true,
    );
  });

  it('isProseSection only matches the literal prose tag', () => {
    expect(isProseSection('prose')).toBe(true);
    expect(isProseSection('verse')).toBe(false);
    expect(isProseSection(null)).toBe(false);
    expect(isProseSection(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------
// 4. Source contracts — VerseAnatomy.astro prose branch
// ---------------------------------------------------------------

describe('VerseAnatomy.astro source contract', () => {
  const source = readSource('src', 'components', 'VerseAnatomy.astro');

  it('imports the shared helpers and no longer defines formatDanda locally', () => {
    expect(source).toMatch(/from '\.\.\/lib\/prose'/);
    expect(source).toMatch(/isProseSection/);
    expect(source).not.toMatch(/function formatDanda/);
  });

  it('has an explicit prose branch keyed on section_type', () => {
    expect(source).toMatch(/const isProse = isProseSection\(verse\.section_type\)/);
    expect(source).toMatch(/data-section-type=\{mode\}/);
  });

  it('prose Devanāgarī renders flowing paragraphs, not the danda-split block', () => {
    expect(source).toMatch(/class="prose-devanagari"/);
    expect(source).toMatch(/devanagariParas\.map/);
    // verse path still uses formatDanda + pre-line, untouched
    expect(source).toMatch(/formatDanda\(verse\.devanagari\)/);
    expect(source).toMatch(/white-space: pre-line/);
  });

  it('prose Devanāgarī is body-scale (18-19px), not the 26px verse display', () => {
    const proseCss = source.match(/\.prose-devanagari \{[^}]+\}/);
    expect(proseCss?.[0]).toContain('font-size: var(--text-md)');
    expect(proseCss?.[0]).not.toContain('1.625rem');
    expect(source).toMatch(/1\.1875rem;? \/\* 19px/);
    expect(source).toMatch(/\.prose-devanagari p \{[^}]*white-space: normal/);
  });

  it('prose IAST is a collapsed-by-default <details>', () => {
    expect(source).toContain('<details class="prose-iast">');
    expect(source).not.toMatch(/<details class="prose-iast"[^>]*\bopen\b/);
    expect(source).toMatch(/data-i18n="verse\.prose_iast_summary"/);
  });

  it('renders the synonyms region for any block (verse OR prose) that carries word-glosses', () => {
    // Format parity: prose blocks show the word-by-word region just like
    // verse texts when glosses are present (gated only on glossCount, not
    // section_type). The prose still renders as flowing paragraphs above.
    expect(source).toMatch(/\{wordGlosses\.length > 0 \? \(/);
    expect(source).not.toMatch(/\{!isProse && wordGlosses\.length > 0 \? \(/);
  });

  it('renders prose translations as multiple <p> on blank lines', () => {
    expect(source).toMatch(/splitProseParagraphs\(primaryTranslation\.translation_text\)\.map/);
    expect(source).toMatch(/splitProseParagraphs\(t\.translation_text\)\.map/);
  });

  it("rail aria-label switches 'Verse' to 'Block' for prose", () => {
    expect(source).toContain("isProse ? 'Block' : 'Verse'");
  });
});

// ---------------------------------------------------------------
// 5. Source contracts — verse pages + overview pages + i18n
// ---------------------------------------------------------------

const VERSE_PAGES = [
  ['src', 'pages', '[tradition]', '[text]', '[chapter]', '[verse].astro'],
  ['src', 'pages', '[lang]', '[tradition]', '[text]', '[chapter]', '[verse].astro'],
] as const;

const OVERVIEW_PAGES = [
  ['src', 'pages', '[tradition]', '[text]', 'index.astro'],
  ['src', 'pages', '[lang]', '[tradition]', '[text]', 'index.astro'],
] as const;

describe('verse pages source contract', () => {
  for (const segments of VERSE_PAGES) {
    const label = segments.join('/');
    const source = readSource(...segments);

    it(`${label}: routes isShortVerse through the prose-aware helper`, () => {
      expect(source).toMatch(/computeIsShortVerse\(\{/);
      expect(source).toMatch(/sectionType: verseRow\.section_type/);
      // the raw heuristic must not survive inline (the guard would be lost)
      expect(source).not.toMatch(/wordGlosses\.length === 0;/);
    });

    it(`${label}: switches the nav landmark + prev/next labels for prose`, () => {
      expect(source).toContain("isProse ? 'Passage navigation' : 'Verse navigation'");
      expect(source).toContain("'verse_page.nav_aria_passage'");
      expect(source).toContain("isProse ? 'Previous passage' : 'Previous verse'");
      expect(source).toContain("isProse ? 'Next passage' : 'Next verse'");
    });

    it(`${label}: keeps the numeric chrome locator unchanged`, () => {
      expect(source).toContain('{chapterNum}.{verseNum}');
    });
  }
});

describe('text overview pages source contract', () => {
  for (const segments of OVERVIEW_PAGES) {
    const label = segments.join('/');
    const source = readSource(...segments);

    it(`${label}: switches the column header to Passages for prose texts`, () => {
      expect(source).toMatch(/section_type = 'prose'/);
      expect(source).toContain(
        'isProseText ? "text_overview.table.passages" : "text_overview.table.verses"',
      );
      expect(source).toContain('isProseText ? "Passages" : "Verses"');
    });
  }
});

describe('i18n dictionaries carry the prose keys', () => {
  const NEW_KEYS = [
    'verse.block_aria_prefix',
    'verse.prose_iast_summary',
    'verse_page.nav_aria_passage',
    'verse_page.prev_verse_aria',
    'verse_page.next_verse_aria',
    'verse_page.prev_passage_aria',
    'verse_page.next_passage_aria',
    'text_overview.table.passages',
  ];
  const LOCALES = ['as', 'bn', 'gu', 'hi', 'kn', 'ml', 'mr', 'or', 'pa', 'ta', 'te'];

  it('en.ts defines every new key', () => {
    const source = readSource('src', 'i18n', 'en.ts');
    for (const key of NEW_KEYS) {
      expect(source, `en.ts missing ${key}`).toContain(`'${key}':`);
    }
  });

  for (const locale of LOCALES) {
    it(`${locale}.json translates every new key`, () => {
      const dict = JSON.parse(readSource('src', 'i18n', `${locale}.json`)) as Record<
        string,
        string
      >;
      for (const key of NEW_KEYS) {
        expect(dict[key], `${locale}.json missing ${key}`).toBeTruthy();
      }
    });
  }
});

describe('db row type carries section_type through to the pages', () => {
  it('Verse interface types the new columns (SELECT v.* already returns them)', () => {
    const source = readSource('src', 'lib', 'db.ts');
    expect(source).toMatch(/section_type\?: 'verse' \| 'prose';/);
    expect(source).toMatch(/prose_block_ref\?: string \| null;/);
  });
});

// ---------------------------------------------------------------
// Regression: dot-danda IAST (Mahānirvāṇa) — bare verse number must
// not collide with the protect-placeholder restore (was rendering
// "undefined"). MNT IAST uses " . " / " .. N .. " for dandas.
// ---------------------------------------------------------------
describe('formatDanda — dot-danda IAST verse numbers (MNT)', () => {
  it('renders the verse number, never "undefined"', () => {
    const out = formatDanda('nānāpakṣiravairyute .. 1 ..');
    expect(out).not.toContain('undefined');
    expect(out).toContain('||1||');
  });
  it('breaks on the half-danda dot and keeps the full-danda number bracket', () => {
    const out = formatDanda('a b c . d e f .. 7 ..');
    expect(out).toContain('||7||');
    expect(out.split('\n').length).toBeGreaterThanOrEqual(2);
  });
  it('does not eat a non-danda use (no space-delimited dot)', () => {
    // pipe + slash conventions still work, no regression
    expect(formatDanda('x || 5 ||')).toContain('||5||');
    expect(formatDanda('y // 2 //')).toContain('||2||');
  });
});
