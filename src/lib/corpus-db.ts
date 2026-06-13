/**
 * Corpus DB factory — edge-compatible READ-ONLY backend for the search
 * route (and any future edge runtime read path against the verse corpus).
 *
 * WHY THIS FILE EXISTS (separate from `src/lib/db.ts`):
 *   `src/lib/db.ts` does `import { Database } from 'bun:sqlite'` at the
 *   TOP LEVEL. That's safe for the SSG path — `getDb()`, `listTexts()`,
 *   `getVerse()`, `getVerseAllLanguages()`, etc. are all called during
 *   `astro build`, which runs in bun on the build host. They never
 *   execute at the edge.
 *
 *   But `GET /api/search` has `export const prerender = false` → it
 *   ships into the Cloudflare Pages Function bundle (workerd). If the
 *   search code reaches into `db.ts` with a STATIC import, the bundler
 *   pulls `bun:sqlite` into the worker bundle as a static module
 *   dependency — and workerd has no `bun:sqlite` module, so the first
 *   request to `/api/search` throws `No such module "bun:sqlite"` at
 *   chunk evaluation time. This was Agent 7's launch BLOCKER finding
 *   in `.gstack/launch/edge-audit-2026-06-01.md` §2a, verified
 *   empirically against `dist/_worker.js/chunks/db_*.mjs`.
 *
 *   This file isolates the edge-runtime corpus read concern. The
 *   `bun:sqlite` reach (via `db.ts`) is DYNAMIC and guarded by a
 *   runtime sniff, so the edge bundle never sees `bun:sqlite` as a
 *   static dependency of the search chunk. The libsql client is
 *   statically imported via the `/web` subpath, which exports a
 *   workerd-safe build (no `node:*` deps).
 *
 *   This mirrors the `subscriber-db.ts` pattern (the gold standard for
 *   the WRITE path) so the two edge-runtime backends share the same
 *   shape and the same lifecycle hooks.
 *
 * ROUTING:
 *   - Bun runtime (local dev, tests, `bun --bun astro dev`): delegates
 *     to `db.ts`'s `getDb()`, which opens the local
 *     `db/sohamhamso.db` file. The async wrapper turns sync
 *     `bun:sqlite` rows into a Promise-shaped surface so the search
 *     module sees the same contract in both runtimes.
 *
 *   - Edge runtime (Cloudflare Pages Function): `@libsql/client/web`
 *     talks to a Turso CORPUS DB over HTTPS. Auth via env vars
 *     `TURSO_CORPUS_URL` + `TURSO_CORPUS_AUTH_TOKEN` (set as
 *     Cloudflare Pages secrets pre-launch — see `.env.example`).
 *
 * TEST INJECTION:
 *   The bun backend reuses `db.ts`'s `getDb()` and therefore honors
 *   the existing `__setDbForTests()` hook transitively. Existing
 *   `tests/unit/search.test.ts` (which injects via `__setDbForTests`)
 *   continues to work without modification.
 *
 *   There's also a `__setCorpusDbForTests(...)` hook below for tests
 *   that want to inject a fake `CorpusDb` directly (the regression
 *   spec uses this to verify shape parity with `subscriber-db.ts`).
 */

/**
 * Detect the runtime. `bun:sqlite` is only safe to reach when we're in
 * the bun process — anywhere else (workerd, node-edge, browser) it
 * must not be referenced at all. `process.versions.bun` is the
 * canonical bun-only marker.
 *
 * Kept identical to `subscriber-db.ts:isBunRuntime` so a future
 * refactor can consolidate the two into a shared `runtime.ts`.
 */
function isBunRuntime(): boolean {
  return typeof process !== 'undefined' && typeof process.versions?.bun === 'string';
}

/**
 * Public surface every corpus-DB backend exposes. The search helpers
 * in `src/lib/search.ts` only ever see this shape — never the
 * underlying driver. Both methods are async so the bun and libsql
 * paths are interchangeable.
 *
 * The interface is intentionally minimal — just the two read verbs
 * search needs. `prepare()` / statement caching is left to each
 * backend internally (bun:sqlite caches by SQL string under the hood;
 * libsql HTTP has no equivalent and doesn't need one).
 */
export interface CorpusDb {
  /**
   * Run a SELECT and return all rows. Bun maps to
   * `db.query<T>(sql).all(...params)`; libsql maps to
   * `client.execute({ sql, args })` and adapts the row shape.
   *
   * Generic `T` is the row shape — typed at the call site so
   * downstream code keeps strong types. Note: at the edge, BLOB
   * columns come back as `ArrayBuffer`/`Uint8Array`, NOT Node
   * `Buffer` — the bun backend wraps with `Buffer.from(...)` so the
   * caller can treat the column as a `Buffer` either way.
   */
  all<T>(sql: string, params?: ReadonlyArray<string | number | null>): Promise<T[]>;

  /**
   * Run a SELECT and return the first row (or `undefined`). Sugar
   * for `(await all(...))[0]`; both backends implement it directly
   * so they can append `LIMIT 1` hints where appropriate.
   */
  get<T>(sql: string, params?: ReadonlyArray<string | number | null>): Promise<T | undefined>;

  /**
   * Run several SELECTs in ONE round-trip and return their row arrays
   * in statement order. This is the latency-critical verb for the SSR
   * verse routes: `getVerse()`-shaped reads need ~10 statements, and
   * sequential HTTPS round-trips to Turso would blow the per-page
   * budget. The edge backend maps to libsql `client.batch(stmts,
   * 'read')` (single HTTP exchange); the bun backend just loops the
   * sync driver (local file — no round-trip cost).
   *
   * OPTIONAL so pre-existing test fakes (which only implement
   * `all`/`get`) keep compiling. Callers must fall back to sequential
   * `all()` when absent — `corpusBatch()` in verse-read.ts does this.
   */
  batch?(
    stmts: ReadonlyArray<CorpusBatchStatement>,
  ): Promise<Array<Array<Record<string, unknown>>>>;
}

/** One statement in a {@link CorpusDb.batch} round-trip. */
export interface CorpusBatchStatement {
  sql: string;
  args?: ReadonlyArray<string | number | null>;
}

/* ─────────────────────────────────────────────────────────────────────
 * Bun runtime backend (local dev + tests + SSG).
 *
 * Delegates to `db.ts`'s `getDb()` so:
 *   1. The `__setDbForTests` hook in `db.ts` still routes test fakes
 *      into search.ts — no test changes required.
 *   2. Path resolution + WAL pragmas + the `:memory:` test override
 *      all stay in one place.
 *
 * The `await import('./db')` is intentionally a STRING LITERAL — Vite
 * follows string-literal source-file imports and creates a chunk
 * split, but the chunk is only LOADED at runtime when the import
 * actually executes. At edge, `isBunRuntime()` is false, this branch
 * never runs, and workerd never evaluates the db chunk that pulls in
 * `bun:sqlite`. (Verified empirically with the post-build grep test
 * documented in `.gstack/launch/edge-audit-2026-06-01.md`.)
 * ──────────────────────────────────────────────────────────────────── */

async function makeBunBackend(): Promise<CorpusDb> {
  // DYNAMIC string-literal import. DO NOT inline this to a static
  // `import { getDb } from './db'` at the top of the file — that
  // would re-introduce the `bun:sqlite` static dep edge that this
  // entire file exists to break.
  const { getDb } = await import('./db');
  const db = getDb();

  return {
    async all<T>(sql: string, params: ReadonlyArray<string | number | null> = []): Promise<T[]> {
      // `bun:sqlite`'s typed query API is sync — wrap in Promise.resolve
      // so callers can `await` uniformly with the libsql backend. The
      // `as any` is local to the adapter; downstream `search.ts` keeps
      // strong types via the generic.
      // biome-ignore lint/suspicious/noExplicitAny: bun:sqlite param-tuple types differ from libsql's flat list
      const stmt = db.query<T, any>(sql);
      // biome-ignore lint/suspicious/noExplicitAny: same as above
      const rows = stmt.all(...(params as any[])) as T[];
      return rows;
    },
    async get<T>(
      sql: string,
      params: ReadonlyArray<string | number | null> = [],
    ): Promise<T | undefined> {
      // biome-ignore lint/suspicious/noExplicitAny: see all()
      const stmt = db.query<T, any>(sql);
      // biome-ignore lint/suspicious/noExplicitAny: see all()
      const row = stmt.get(...(params as any[])) as T | null;
      return row ?? undefined;
    },
    async batch(
      stmts: ReadonlyArray<CorpusBatchStatement>,
    ): Promise<Array<Array<Record<string, unknown>>>> {
      // Local sync driver: sequential statement execution has no
      // round-trip cost, so "batch" is just a loop. Kept in statement
      // order to mirror the libsql contract exactly.
      return stmts.map((s) => {
        // biome-ignore lint/suspicious/noExplicitAny: see all()
        const stmt = db.query<Record<string, unknown>, any>(s.sql);
        // biome-ignore lint/suspicious/noExplicitAny: see all()
        return stmt.all(...((s.args ?? []) as any[]));
      });
    },
  };
}

/* ─────────────────────────────────────────────────────────────────────
 * Edge runtime backend (Cloudflare Pages Function → Turso over HTTPS).
 *
 * `@libsql/client/web` resolves to a workerd-safe build (no node:*).
 * Auth via env vars; both must be set as Cloudflare Pages secrets.
 *
 * Row-shape adaptation:
 *   libsql returns rows as `Record<string, Value>` where `Value` is
 *   `string | number | bigint | ArrayBuffer | null`. The corpus
 *   queries in `search.ts` expect `Buffer` for the `embedding` column
 *   (passed to `bufferToFloat32`) and `string`/`number` for everything
 *   else. We coerce `ArrayBuffer | Uint8Array` → Node `Buffer` here
 *   so the call site stays driver-agnostic.
 * ──────────────────────────────────────────────────────────────────── */

// Module-scope memoization of the libsql client. Cold-starts pay one
// HTTPS handshake; subsequent requests on the same worker instance
// reuse the client (and its HTTP-keepalive connection pool).
// biome-ignore lint/suspicious/noExplicitAny: libsql client type kept opaque to avoid coupling
let _libsqlClient: any | null = null;

async function getLibsqlClient(): Promise<{
  execute: (q: { sql: string; args: unknown[] }) => Promise<{ rows: Record<string, unknown>[] }>;
  batch: (
    stmts: Array<{ sql: string; args: unknown[] }>,
    mode?: 'read' | 'write' | 'deferred',
  ) => Promise<Array<{ rows: Record<string, unknown>[] }>>;
}> {
  if (_libsqlClient) return _libsqlClient;
  const url = process.env.TURSO_CORPUS_URL;
  const authToken = process.env.TURSO_CORPUS_AUTH_TOKEN;
  if (!url || url.length === 0) {
    throw new CorpusNotConfiguredError(
      'Server misconfigured: TURSO_CORPUS_URL is not set. ' +
        'Set it as a Cloudflare Pages secret: ' +
        '`wrangler pages secret put TURSO_CORPUS_URL --project sohamhamso`.',
    );
  }
  if (!authToken || authToken.length === 0) {
    throw new CorpusNotConfiguredError(
      'Server misconfigured: TURSO_CORPUS_AUTH_TOKEN is not set. ' +
        'Set it as a Cloudflare Pages secret: ' +
        '`wrangler pages secret put TURSO_CORPUS_AUTH_TOKEN --project sohamhamso`.',
    );
  }
  // The `/web` subpath is the workerd-safe entrypoint (verified via
  // @libsql/client package.json `exports` map: `workerd` → `web.js`).
  const { createClient } = await import('@libsql/client/web');
  _libsqlClient = createClient({ url, authToken });
  return _libsqlClient;
}

/**
 * Thrown when the corpus DB env vars are missing at the edge. Distinct
 * type so the search handler (or any caller) can render a clear 503
 * "search not configured" instead of leaking a generic 500. Mirrors
 * `subscribe.ts`'s `PepperNotConfiguredError` posture — fail fast and
 * loud when production config is wrong.
 */
export class CorpusNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CorpusNotConfiguredError';
  }
}

/**
 * Coerce a libsql BLOB value into a Node `Buffer`. libsql `/web` hands
 * back `ArrayBuffer` on workerd (per the client's web build); the bun
 * backend already returns `Buffer` natively. Centralizing the
 * normalisation here keeps `search.ts`'s `bufferToFloat32()` shape-stable.
 */
function toBuffer(v: unknown): Buffer {
  if (Buffer.isBuffer(v)) return v;
  if (v instanceof ArrayBuffer) return Buffer.from(v);
  if (v instanceof Uint8Array) return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
  // Defensive: libsql could in theory return a base64 string for BLOBs;
  // not seen in `/web` today, but guard anyway so a future driver
  // update doesn't silently corrupt embeddings.
  if (typeof v === 'string') return Buffer.from(v, 'base64');
  throw new Error(`corpus-db: unexpected BLOB value type: ${typeof v}`);
}

async function makeEdgeBackend(): Promise<CorpusDb> {
  const client = await getLibsqlClient();

  function adaptRow<T>(row: Record<string, unknown>): T {
    // Pass through everything except BLOB columns. The only BLOB column
    // in the corpus schema today is `verse_embeddings.embedding`; coerce
    // it to `Buffer` so `bufferToFloat32()` in search.ts works unchanged.
    if ('embedding' in row && row.embedding != null) {
      return { ...row, embedding: toBuffer(row.embedding) } as T;
    }
    return row as T;
  }

  return {
    async all<T>(sql: string, params: ReadonlyArray<string | number | null> = []): Promise<T[]> {
      const res = await client.execute({ sql, args: [...params] });
      return res.rows.map((r) => adaptRow<T>(r));
    },
    async get<T>(
      sql: string,
      params: ReadonlyArray<string | number | null> = [],
    ): Promise<T | undefined> {
      const res = await client.execute({ sql, args: [...params] });
      if (res.rows.length === 0) return undefined;
      return adaptRow<T>(res.rows[0]);
    },
    async batch(
      stmts: ReadonlyArray<CorpusBatchStatement>,
    ): Promise<Array<Array<Record<string, unknown>>>> {
      // 'read' mode: read-only batch over a single HTTP exchange. All
      // statements here are SELECTs (the corpus DB is read-only from
      // the worker), so the read transaction mode is both correct and
      // the cheapest option on Turso.
      const results = await client.batch(
        stmts.map((s) => ({ sql: s.sql, args: [...(s.args ?? [])] })),
        'read',
      );
      return results.map((res) => res.rows.map((r) => adaptRow<Record<string, unknown>>(r)));
    },
  };
}

/* ─────────────────────────────────────────────────────────────────────
 * Module-scope singleton + test injection hook.
 * ──────────────────────────────────────────────────────────────────── */

let _backendPromise: Promise<CorpusDb> | null = null;
let _injected: CorpusDb | null = null;

/**
 * Returns the singleton corpus DB for this runtime. Memoizes the
 * factory promise so cold-start work (libsql client construction in
 * the edge case) runs at most once per worker instance.
 *
 * Tests can pre-empt the routing by calling `__setCorpusDbForTests`,
 * or by injecting a `Database` via `db.ts`'s `__setDbForTests` (the
 * bun backend delegates through `getDb()`).
 */
export function getCorpusDb(): Promise<CorpusDb> {
  if (_injected) return Promise.resolve(_injected);
  if (_backendPromise) return _backendPromise;
  _backendPromise = isBunRuntime() ? makeBunBackend() : makeEdgeBackend();
  return _backendPromise;
}

/**
 * Test hook — inject a fake `CorpusDb` implementation. Pass `null` to
 * clear and force the next `getCorpusDb()` to re-resolve via the
 * normal runtime sniff. Production code MUST NOT call this.
 */
export function __setCorpusDbForTests(db: CorpusDb | null): void {
  _injected = db;
  if (db !== null) {
    _backendPromise = null;
  }
}

/**
 * Runtime sniff — exported so callers (e.g. the search handler) can
 * apply edge-only guards without duplicating the detection logic.
 * Matches the convention in `subscriber-db.ts`.
 */
export function isEdgeRuntime(): boolean {
  return !isBunRuntime();
}
