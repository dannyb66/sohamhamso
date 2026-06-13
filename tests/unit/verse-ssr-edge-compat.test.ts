/**
 * Edge-compat invariants for the SSR verse routes (A6 phase 2).
 *
 * The two verse routes are `prerender = false` — they ship into the
 * Cloudflare Pages worker bundle. The same failure mode that hit Masthead
 * (masthead-edge-compat.regression-1.test.ts) applies: a VALUE import
 * from `src/lib/db.ts` would drag `bun:sqlite` into the worker chunk and
 * 500 every verse page at module-evaluation time. These specs pin the
 * source-level contract:
 *
 *   1. Both routes export `prerender = false` (the entire A6 phase 2
 *      point — verse pages must not return to file-per-route output
 *      without revisiting the CF Pages 20k-file budget).
 *   2. Neither route defines getStaticPaths (dead under SSR; its alias
 *      redirect surface moved to resolveVerseAlias + public/_redirects).
 *   3. Neither route VALUE-imports from src/lib/db (type-only is fine —
 *      erased at compile time).
 *   4. Both routes read through src/lib/verse-read (the CorpusDb-backed
 *      batched read) and 301 aliases via resolveVerseAlias.
 *   5. verse-read.ts itself only TYPE-imports db.ts.
 *   6. SEO head parity: both routes still build the verse head via
 *      buildVerseSeo (canonical + hreflang + JSON-LD come from the same
 *      builder the static pages used, so tags can't silently drift).
 *   7. The alias wildcard surface in scripts/seo-build-redirects.ts still
 *      enumerates verse URLs (`/{wrong}/{slug}/* → /{canon}/{slug}/:splat`)
 *      now that the per-verse static redirect pages are gone.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRedirectRules } from '../../scripts/seo-build-redirects';
import { enumerateRedirectPairs } from '../../src/lib/aliases';

const ROOT = resolve(__dirname, '..', '..');
const EN_ROUTE = resolve(ROOT, 'src/pages/[tradition]/[text]/[chapter]/[verse].astro');
const LANG_ROUTE = resolve(ROOT, 'src/pages/[lang]/[tradition]/[text]/[chapter]/[verse].astro');
const VERSE_READ = resolve(ROOT, 'src/lib/verse-read.ts');

/** Value-level import lines from a module path (type-only lines stripped). */
function valueImportsOf(src: string, modulePattern: RegExp): string[] {
  return src
    .split('\n')
    .filter((line) => /^\s*import\s/.test(line) || /from\s+['"]/.test(line))
    .filter((line) => !/^\s*import\s+type\s/.test(line))
    .filter((line) => modulePattern.test(line));
}

for (const [label, path] of [
  ['root route', EN_ROUTE],
  ['[lang] route', LANG_ROUTE],
] as const) {
  describe(`SSR verse page — ${label}`, () => {
    const src = readFileSync(path, 'utf8');

    it('exports prerender = false', () => {
      expect(src).toMatch(/export\s+const\s+prerender\s*=\s*false/);
    });

    it('does NOT define getStaticPaths', () => {
      // Prose mentions in comments are fine; an actual definition or
      // export is not (it would be dead code under SSR and invites the
      // static alias pages back).
      expect(src).not.toMatch(/function\s+getStaticPaths|getStaticPaths\s*[=(]/);
    });

    it('does NOT value-import from src/lib/db (bun:sqlite stays out of the worker)', () => {
      const offenders = valueImportsOf(src, /from\s+['"][^'"]*lib\/db['"]/);
      expect(offenders, `value imports of lib/db found:\n${offenders.join('\n')}`).toHaveLength(0);
    });

    it('does NOT import the db-backed corpus-bundle helpers', () => {
      for (const banned of [
        'getVersePageCached',
        'getVerseAvailability',
        'getCanonicalVerseRoutes',
        'getLemmaSummaryByIast',
        'getVerseAllLanguages',
        'getVerseTranslations',
        'listChapters',
        'enumerateRedirectPairs',
      ]) {
        expect(src, `${banned} must not appear in the SSR route`).not.toContain(banned);
      }
    });

    it('reads through verse-read.ts and resolves aliases in-handler', () => {
      expect(src).toMatch(/readVersePage/);
      expect(src).toMatch(/resolveVerseAlias/);
      expect(src).toMatch(/Astro\.redirect\(/);
      expect(src).toMatch(/301/);
    });

    it('keeps the SEO head on buildVerseSeo (canonical/hreflang parity)', () => {
      expect(src).toMatch(/buildVerseSeo\(/);
      expect(src).toMatch(/canonical=\{view\.pageSeo\.canonical\}/);
      expect(src).toMatch(/hreflang=\{view\.pageSeo\.hreflang\}/);
    });

    it('sets the deploy-bounded cache policy on OK responses', () => {
      expect(src).toMatch(/s-maxage=86400/);
      expect(src).toMatch(/stale-while-revalidate/);
    });
  });
}

describe('verse-read.ts — driver isolation', () => {
  const src = readFileSync(VERSE_READ, 'utf8');

  it('only TYPE-imports from src/lib/db', () => {
    const offenders = valueImportsOf(src, /from\s+['"]\.\/db['"]/);
    expect(offenders, `value imports of ./db found:\n${offenders.join('\n')}`).toHaveLength(0);
  });

  it('never imports bun:sqlite (comments may explain it; code may not load it)', () => {
    expect(src).not.toMatch(/import[^;]*['"]bun:sqlite['"]|require\(\s*['"]bun:sqlite['"]/);
  });
});

describe('corpus seo overrides — SSR limitation tripwire', () => {
  it('every live corpus YAML declares EMPTY noindex_langs (edge cannot read data/corpus)', () => {
    // The SSR verse routes call buildVerseSeo(), which resolves
    // `seo.noindex_langs` through corpus-overrides.ts → node:fs reads of
    // data/corpus/*.yaml. In the deployed worker that directory does not
    // exist (workerd virtual fs), so overrides resolve to EMPTY — which
    // is only correct while every text's noindex_langs is []. If this
    // test fails, someone added a noindex_lang: the static pages would
    // honor it but the SSR verse pages would NOT (hreflang/noindex
    // drift). Fix = give corpus-overrides an edge-safe data source (e.g.
    // a build-time JSON snapshot) before landing that YAML change.
    const corpusDir = resolve(ROOT, 'data', 'corpus');
    const files = readdirSync(corpusDir).filter(
      (name) => /\.ya?ml$/i.test(name) && !name.startsWith('_') && !/\.faq\.ya?ml$/i.test(name),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const src = readFileSync(resolve(corpusDir, name), 'utf8');
      const m = src.match(/^\s*noindex_langs:\s*(.*)$/m);
      if (m) {
        expect(
          m[1].trim(),
          `${name}: noindex_langs must stay empty while verse SSR cannot read corpus overrides at the edge`,
        ).toBe('[]');
      }
    }
  });
});

describe('alias surface — _redirects wildcards still cover verse URLs', () => {
  it('emits a /{wrong}/{slug}/* wildcard for every redirect pair (verse URLs covered)', () => {
    const pairs = enumerateRedirectPairs();
    expect(pairs.length).toBeGreaterThan(0);
    const rules = buildRedirectRules(pairs);
    for (const pair of pairs) {
      const wildcard = rules.find(
        (r) =>
          r.from === `/${pair.wrongTradition}/${pair.wrongSlug}/*` &&
          r.to === `/${pair.canonicalTradition}/${pair.canonicalSlug}/:splat` &&
          r.status === 301,
      );
      expect(
        wildcard,
        `missing verse wildcard for /${pair.wrongTradition}/${pair.wrongSlug}/*`,
      ).toBeDefined();
    }
  });
});
