/**
 * Build-time materialization of the corpus-wide lemma index.
 *
 * WHY THIS FILE EXISTS: the SSR verse route (src/lib/verse-read.ts) needs,
 * for each verse, the {slug, corpus-wide occurrence count} of every lemma
 * it glosses. Deriving that at request time meant full-scanning
 * `word_glosses` once per Cloudflare worker isolate — ~180k rows read from
 * Turso (billed per row) on every cold isolate, which exhausted the read
 * quota. We instead materialize the index ONCE at build time into the
 * `lemma_index` table; the edge then reads only the handful of lemmas a
 * verse uses, by primary key (see scripts/turso-seed-lemma-index.ts for
 * the Turso push).
 *
 * CONSISTENCY CONTRACT: the `slug` written here MUST equal what the static
 * `/lemma/` pages compute (src/lib/seo/corpus-bundle.ts:ensureLemmaIndex),
 * so SSR verse pages link to the same `/lemma/{slug}` URLs. That means the
 * SAME seed query (GROUP BY lemma_iast, ORDER BY MIN(verse_id) ASC,
 * lemma_iast ASC) and the SAME collision walk (seo/slug.ts:assignLemmaSlug)
 * applied in that order. Keep the query below in lockstep with both.
 */

import type { Database } from 'bun:sqlite';
import { assignLemmaSlug } from '../../src/lib/seo/slug';

/**
 * Seed query for the lemma index. Identical shape (and crucially, identical
 * ORDER BY) to corpus-bundle.ts:ensureLemmaIndex and
 * verse-read.ts's former lemma scan, so slug assignment is deterministic
 * and matches the static lemma pages.
 */
export const LEMMA_INDEX_SELECT = `
  SELECT
    g.lemma_iast AS lemma_iast,
    COUNT(DISTINCT g.verse_id) AS occurrence_count
  FROM word_glosses g
  WHERE g.lemma_iast IS NOT NULL
    AND TRIM(g.lemma_iast) != ''
  GROUP BY g.lemma_iast
  ORDER BY MIN(g.verse_id) ASC, g.lemma_iast ASC
`;

/**
 * (Re)build the `lemma_index` table from `word_glosses`. Idempotent: clears
 * the table first, so a re-run on an unchanged corpus is a no-op in effect.
 * Returns the number of distinct lemmas indexed.
 */
export function buildLemmaIndex(db: Database): number {
  const rows = db
    .query<{ lemma_iast: string; occurrence_count: number }, []>(LEMMA_INDEX_SELECT)
    .all();

  const insert = db.query(
    'INSERT OR REPLACE INTO lemma_index (lemma_iast, slug, occurrence_count) VALUES (?, ?, ?)',
  );

  const seen = new Set<string>();
  const run = db.transaction(() => {
    db.exec('DELETE FROM lemma_index');
    for (const row of rows) {
      const slug = assignLemmaSlug(row.lemma_iast, seen);
      seen.add(slug);
      insert.run(row.lemma_iast, slug, row.occurrence_count);
    }
  });
  run();

  return rows.length;
}
