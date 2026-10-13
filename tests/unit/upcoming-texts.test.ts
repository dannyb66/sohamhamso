import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
/**
 * D7 remainder — upcoming-text notice on search zero-results + 404:
 *
 *   - matcher: normalized-contains query matching across the alias
 *     variants and diacritic (IAST) input; launched Parātrīśikā and IPK
 *     must not produce upcoming notices
 *   - path matcher: only the first three segments of a 404'd path count
 *   - self-consistency: variants are pre-normalized; each entry has a
 *     staged corpus file (`data/corpus/_staged-<slug>.yaml`) and stays a
 *     subset of PHASE2_TEXTS in scripts/demand-dashboard.ts
 *   - render check: Astro's `experimental_AstroContainer` cannot render
 *     `.astro` pages in this setup (see tests/unit/chapter-titles.test.ts),
 *     so the search empty state + 404 line are source-level fixture checks
 *   - i18n: both `upcoming.*` keys exist in en.ts and all 11 JSON dicts
 *
 * Run with: `bun --bun vitest run tests/unit/upcoming-texts.test.ts`
 */
import { describe, expect, it } from 'vitest';
import { PHASE2_TEXTS } from '../../scripts/demand-dashboard';
import { en } from '../../src/i18n/en';
import {
  UPCOMING_TEXTS,
  matchUpcoming,
  matchUpcomingPath,
  normalizeUpcoming,
} from '../../src/lib/upcoming-texts';

const ROOT = resolve(__dirname, '..', '..');

describe('normalizeUpcoming', () => {
  it('lowercases and strips combining diacritics', () => {
    expect(normalizeUpcoming('Parātrīśikā')).toBe('paratrisika');
    expect(normalizeUpcoming('Īśvarapratyabhijñā Kārikā')).toBe('isvarapratyabhijna karika');
  });

  it('keeps -, space, and / separators intact', () => {
    expect(normalizeUpcoming('/trika/para-trisika')).toBe('/trika/para-trisika');
  });
});

const LAUNCHED_QUERIES = [
  'paratrisika',
  'paratrishika',
  'paratrimshika',
  'para-trisika',
  'Parātrīśikā',
  'paratrishika verse 1',
  'isvarapratyabhijna-karika',
  'ishvarapratyabhijna',
  'ishvara-pratyabhijna karika',
  'Īśvarapratyabhijñā Kārikā',
  'pratyabhijna karika 1.1',
];

describe('matchUpcoming (search query)', () => {
  it.each(LAUNCHED_QUERIES)('does not label launched text %s as upcoming', (query) => {
    expect(matchUpcoming(query)).toBeNull();
  });

  it('does not false-positive on other live texts or near-misses', () => {
    expect(matchUpcoming('pratyabhijna hrdayam')).toBeNull();
    expect(matchUpcoming('pratyabhijna')).toBeNull();
    expect(matchUpcoming('siva sutras')).toBeNull();
    expect(matchUpcoming('')).toBeNull();
    expect(matchUpcoming('   ')).toBeNull();
  });
});

describe('matchUpcomingPath (404 path)', () => {
  it.each([
    '/trika/paratrishika/1/1',
    '/paratrisika',
    '/trika/isvarapratyabhijna-karika',
    '/hi/trika/paratrisika/1/1',
    '/ta/trika/isvarapratyabhijna-karika/99/99',
  ])('does not label a launched text path %s as upcoming', (path) => {
    expect(matchUpcomingPath(path)).toBeNull();
  });

  it('returns null for other live-text 404s and the root', () => {
    expect(matchUpcomingPath('/trika/siva-sutras/99/99')).toBeNull();
    expect(matchUpcomingPath('/')).toBeNull();
  });

  it('strips querystring/fragment before matching (query text is not a path)', () => {
    expect(matchUpcomingPath('/search?q=paratrisika')).toBeNull();
    expect(matchUpcomingPath('/texts#paratrisika')).toBeNull();
  });
});

describe('UPCOMING_TEXTS self-consistency', () => {
  it('every variant is already normalized (matcher precondition)', () => {
    for (const t of UPCOMING_TEXTS) {
      for (const v of t.variants) {
        expect(normalizeUpcoming(v)).toBe(v);
      }
    }
  });

  it('every title matches its own entry (diacritic title queries hit)', () => {
    for (const t of UPCOMING_TEXTS) {
      expect(matchUpcoming(t.title)?.slug).toBe(t.slug);
    }
  });

  it('every entry has a staged corpus file (source-of-truth tie)', () => {
    const staged = readdirSync(join(ROOT, 'data', 'corpus')).filter((f) =>
      f.startsWith('_staged-'),
    );
    for (const t of UPCOMING_TEXTS) {
      expect(staged).toContain(`_staged-${t.slug}.yaml`);
    }
  });

  it('does not include any text already present in the ingestion corpus', () => {
    const activeSlugs = readdirSync(join(ROOT, 'data', 'corpus'))
      .filter(
        (file) => file.endsWith('.yaml') && !file.startsWith('_') && !file.endsWith('.faq.yaml'),
      )
      .map((file) => file.slice(0, -'.yaml'.length));
    for (const text of UPCOMING_TEXTS) {
      expect(activeSlugs, `${text.slug} is already ingested`).not.toContain(text.slug);
    }
  });

  it('stays a subset of PHASE2_TEXTS (demand-dashboard agreement)', () => {
    const phase2Slugs = new Set(PHASE2_TEXTS.map((t) => t.slug));
    for (const t of UPCOMING_TEXTS) {
      expect(phase2Slugs.has(t.slug)).toBe(true);
    }
  });
});

describe('surface wiring (source-level render checks)', () => {
  it('search.astro renders the upcoming line inside the zero-results state', () => {
    const src = readFileSync(join(ROOT, 'src', 'pages', 'search.astro'), 'utf8');
    expect(src).toContain("import { matchUpcoming } from '../lib/upcoming-texts'");
    // Gated to the genuine zero-results branch only.
    expect(src).toMatch(
      /q && !stub && !searchError && results\.length === 0 \? matchUpcoming\(q\)/,
    );
    // The quiet line: bare title sibling + the two swappable i18n leaves
    // linking to /daily.
    expect(src).toContain('class="search-page__upcoming"');
    expect(src).toContain('<em>{upcoming.title}</em>');
    expect(src).toContain('<span data-i18n="upcoming.in_preparation">is in preparation</span>');
    expect(src).toContain('<a href="/daily" data-i18n="upcoming.get_notified">get notified</a>');
  });

  it('404.astro embeds the variants payload and the client-side matcher', () => {
    const src = readFileSync(join(ROOT, 'src', 'pages', '404.astro'), 'utf8');
    expect(src).toContain("import { UPCOMING_TEXTS } from '../lib/upcoming-texts'");
    // XSS posture: the inlined JSON payload MUST route through
    // safeJsonForScript (see src/lib/safe-json.ts invariant).
    expect(src).toContain('safeJsonForScript(upcomingPayload)');
    // Hidden-by-default line, unhidden client-side on a path match.
    expect(src).toMatch(/<p class="not-found__upcoming" data-upcoming hidden>/);
    expect(src).toContain('<em data-upcoming-title></em>');
    expect(src).toContain('<a href="/daily" data-i18n="upcoming.get_notified">get notified</a>');
    // The inline script mirrors matchUpcomingPath: first three segments only.
    expect(src).toContain('.slice(0, 3)');
    expect(src).toContain('location.pathname');
  });

  it('both upcoming.* keys ship in en.ts and all 11 locale dicts', () => {
    const keys = ['upcoming.in_preparation', 'upcoming.get_notified'] as const;
    for (const key of keys) {
      expect((en as Record<string, string>)[key]).toBeTruthy();
    }
    const i18nDir = join(ROOT, 'src', 'i18n');
    const jsonFiles = readdirSync(i18nDir).filter((f) => f.endsWith('.json'));
    expect(jsonFiles).toHaveLength(11);
    for (const file of jsonFiles) {
      const dict = JSON.parse(readFileSync(join(i18nDir, file), 'utf8')) as Record<string, string>;
      for (const key of keys) {
        expect(dict[key], `${file} missing ${key}`).toBeTruthy();
      }
    }
  });
});
