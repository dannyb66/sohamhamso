/**
 * Search-miss demand instrument — fire-and-forget logging of zero-result
 * search queries into a `search_misses` table in the CORPUS Turso DB.
 *
 * WHY: the Phase 2 demand gate (docs/INGESTION.md §Step 1) needs per-text
 * demand evidence. A search that returns zero hits is the cheapest honest
 * signal of unmet demand — e.g. a reader searching "tantrasara" before the
 * Phase 2 text ships. `scripts/demand-dashboard.ts` aggregates this table
 * weekly and matches misses against the Phase 2 slug/alias variants.
 *
 * PRIVACY POSTURE (load-bearing — do not weaken):
 *   - Query text only: sanitized to printable chars, truncated to 80.
 *   - Day-bucket timestamp (YYYY-MM-DD) — no time-of-day correlation.
 *   - NO IP, NO User-Agent, NO session/subscriber linkage of any kind.
 *
 * RELIABILITY POSTURE: `logSearchMiss()` NEVER throws and is designed to be
 * fired without await from the search response path — a failed insert (cold
 * table, missing env, Turso hiccup) must never block or fail a search.
 *
 * EDGE SAFETY: routes through `getCorpusDb()` (src/lib/corpus-db.ts), the
 * edge-safe corpus backend. The import is DYNAMIC so this module stays
 * dependency-free for pure-function consumers (the sanitizer unit tests).
 * Note: `CorpusDb.all()` is documented for SELECTs, but both backends
 * execute arbitrary single statements (bun:sqlite `query().all()` returns
 * `[]` for non-SELECT; libsql `execute()` accepts any SQL) — the DDL +
 * INSERT below lean on that deliberately, with this comment as the contract
 * note. Single statements only — neither backend does multi-statement SQL.
 */

import type { CorpusDb } from './corpus-db';

/** Hard cap on stored query length (chars, post-sanitization). */
export const MISS_QUERY_MAX_LEN = 80;

/**
 * Sanitize a raw search query for storage:
 *   - control chars (C0 + DEL + C1) → space (kills log-injection / weird
 *     terminal escapes in the dashboard readout)
 *   - whitespace runs collapsed to a single space, ends trimmed
 *   - truncated to MISS_QUERY_MAX_LEN chars
 *
 * Unicode letters are PRESERVED — Devanāgarī / Indic-script queries are
 * legitimate demand signals, not noise.
 *
 * Exported for unit-test coverage (tests/unit/demand-dashboard.test.ts).
 */
export function sanitizeMissQuery(raw: string): string {
  return (
    raw
      // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars is this sanitizer's job
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MISS_QUERY_MAX_LEN)
  );
}

/**
 * Day-bucket timestamp: YYYY-MM-DD (UTC). Coarse on purpose — see the
 * privacy posture in the module header.
 */
export function missDayBucket(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

// Self-contained bootstrap — a freshly-provisioned corpus DB self-heals on
// the first miss, mirroring the subscribers-table bootstrap posture
// described in .env.example. Idempotent; runs at most once per process
// (memoized below) and retries on the next miss if it failed.
const CREATE_TABLE_SQL =
  'CREATE TABLE IF NOT EXISTS search_misses (' +
  'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
  'query TEXT NOT NULL, ' +
  "lang TEXT NOT NULL DEFAULT 'en', " +
  "search_type TEXT NOT NULL DEFAULT 'lexical', " +
  'day TEXT NOT NULL)';

const CREATE_INDEX_SQL = 'CREATE INDEX IF NOT EXISTS idx_search_misses_day ON search_misses(day)';

let _bootstrapPromise: Promise<void> | null = null;

function ensureTable(db: CorpusDb): Promise<void> {
  if (_bootstrapPromise) return _bootstrapPromise;
  _bootstrapPromise = (async () => {
    await db.all(CREATE_TABLE_SQL);
    await db.all(CREATE_INDEX_SQL);
  })().catch((e) => {
    // Reset so the next miss retries the bootstrap instead of caching a
    // transient failure forever on this worker instance.
    _bootstrapPromise = null;
    throw e;
  });
  return _bootstrapPromise;
}

/**
 * Record one zero-result search. Resolves (never rejects) when the write
 * lands or is abandoned. Intended call shape from the search route:
 *
 *   const p = logSearchMiss(qRaw, lang, type);
 *   // best-effort: keep the CF worker alive for the write if ctx exists
 *   locals?.runtime?.ctx?.waitUntil?.(p);
 *
 * Do NOT await it on the response path.
 */
export async function logSearchMiss(
  rawQuery: string,
  lang: string,
  searchType: string,
): Promise<void> {
  try {
    const query = sanitizeMissQuery(rawQuery);
    if (!query) return; // nothing printable left — not a useful signal
    // Dynamic import keeps this module pure for unit tests and defers the
    // corpus-db chunk until a miss actually happens.
    const { getCorpusDb } = await import('./corpus-db');
    const db = await getCorpusDb();
    await ensureTable(db);
    await db.all('INSERT INTO search_misses (query, lang, search_type, day) VALUES (?, ?, ?, ?)', [
      query,
      lang.slice(0, 8),
      searchType.slice(0, 16),
      missDayBucket(),
    ]);
  } catch {
    // Swallow everything — a lost demand data-point is acceptable; a broken
    // search response is not.
  }
}

/** Test hook — reset the bootstrap memo between test cases. */
export function __resetSearchMissBootstrapForTests(): void {
  _bootstrapPromise = null;
}
