/**
 * Phase 2 upcoming-text notices (design amendment D7, display half — the
 * logging half is src/lib/search-miss.ts).
 *
 * When a reader searches for (or types a URL toward) a text that is staged
 * but not yet live, the zero-result / 404 surfaces render one quiet line:
 *
 *   "{Title} is in preparation — get notified"   → links to /daily
 *
 * Consumed by:
 *   - src/pages/search.astro  (zero-results state, SSR — `matchUpcoming`)
 *   - src/pages/404.astro     (static page; a dependency-free inline script
 *                              mirrors `matchUpcomingPath` client-side over
 *                              `location.pathname`, fed by UPCOMING_TEXTS)
 *
 * Source of truth: the hardcoded const below — exactly the texts that exist
 * as staged corpus files (`data/corpus/_staged-paratrisika.yaml`,
 * `data/corpus/_staged-isvarapratyabhijna-karika.yaml`). When a staged text
 * goes live (the `_staged-` prefix is dropped and the text ingests), REMOVE
 * its entry here; when a new text is staged, add one. Variant spellings
 * follow the same sound-equivalence rules of thumb as src/lib/aliases.ts
 * (vocalic ṛ → r/ri, ś → s/sh, ṃś → ms/msh, sandhi → spelled-out compound)
 * and stay consistent with PHASE2_TEXTS in scripts/demand-dashboard.ts.
 *
 * All functions are PURE (no I/O) — this module must stay importable from
 * both edge SSR and unit tests without dragging in a DB backend.
 */

export interface UpcomingText {
  /** Canonical slug the text will ship under (matches the staged YAML id). */
  slug: string;
  /**
   * Display title — EN/IAST with diacritics. Rendered verbatim in every
   * locale; only the surrounding "is in preparation — get notified" copy is
   * swapped via the `upcoming.*` i18n keys.
   */
  title: string;
  /**
   * Pre-normalized (lowercase, diacritic-free) slug/alias variants matched
   * as substrings of the normalized query / path head. Must each contain
   * enough of the name to never collide with a LIVE text (e.g. bare
   * "pratyabhijna" would false-positive on pratyabhijna-hrdayam).
   */
  variants: readonly string[];
}

export const UPCOMING_TEXTS: readonly UpcomingText[] = [
  {
    slug: 'paratrisika',
    title: 'Parātrīśikā',
    variants: ['paratrisika', 'paratrishika', 'paratrimsika', 'paratrimshika', 'para-trisika'],
  },
  {
    slug: 'isvarapratyabhijna-karika',
    title: 'Īśvarapratyabhijñā Kārikā',
    variants: [
      'isvarapratyabhijna',
      'ishvarapratyabhijna',
      'isvara-pratyabhijna',
      'ishvara-pratyabhijna',
      'pratyabhijna karika',
      'pratyabhijna-karika',
    ],
  },
];

/**
 * Normalize a query or URL path for matching: lowercase, strip combining
 * diacritics (NFD), keep `-`/space/`/` separators intact so hyphenated
 * variants still match. Same shape as `normalizeForMatch` in
 * scripts/demand-dashboard.ts so search-miss demand rows and this display
 * surface agree on what counts as a hit.
 */
export function normalizeUpcoming(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFD')
      // biome-ignore lint/suspicious/noMisleadingCharacterClass: standalone combining marks post-NFD are the target
      .replace(/[\u0300-\u036f]/g, '')
  );
}

/**
 * Match a free-text search query against the upcoming texts: simple
 * normalized substring containment of any variant. Returns the first
 * matching text or null. `matchUpcoming('Parātrīśikā 1.1')` hits the
 * `paratrisika` variant.
 */
export function matchUpcoming(input: string): UpcomingText | null {
  const norm = normalizeUpcoming(input);
  if (!norm) return null;
  for (const text of UPCOMING_TEXTS) {
    for (const variant of text.variants) {
      if (norm.includes(variant)) return text;
    }
  }
  return null;
}

/**
 * Match a 404'd URL path: only the FIRST THREE segments are considered, so
 * `/trika/paratrishika/1/1` and `/hi/trika/paratrisika` match but a deep
 * path that merely mentions a variant later does not. The 404 page's inline
 * script mirrors this logic client-side (404.astro is prerendered static).
 */
export function matchUpcomingPath(pathname: string): UpcomingText | null {
  const head = pathname.split(/[?#]/)[0].split('/').filter(Boolean).slice(0, 3).join('/');
  if (!head) return null;
  return matchUpcoming(head);
}
