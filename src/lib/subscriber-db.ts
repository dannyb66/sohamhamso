/**
 * Subscriber DB factory — edge-compatible writable backend.
 *
 * WHY THIS FILE EXISTS (separate from `src/lib/db.ts`):
 *   `src/lib/db.ts` does `import { Database } from 'bun:sqlite'` at the
 *   TOP LEVEL. That's safe because every caller of `db.ts` runs in the
 *   bun runtime (corpus reads execute at `astro build` time, never at
 *   the edge). But `POST /api/subscribe` is a server-rendered endpoint
 *   that ships into the Cloudflare Pages Function bundle. If the
 *   subscribe handler reaches into `db.ts`, the bundler statically pulls
 *   `bun:sqlite` into the Worker — and Workers have neither bun nor a
 *   writable filesystem, so the bundle either fails at build or 500s on
 *   first request.
 *
 *   This file isolates the writable-DB concern. The `bun:sqlite` import
 *   is DYNAMIC and guarded by a runtime sniff, so the edge bundle never
 *   sees it as a static dependency. The libsql client is statically
 *   imported via the `/web` subpath, which exports a workerd-safe build
 *   (no node:* deps).
 *
 * ROUTING:
 *   - Bun runtime (local dev, tests, `bun --bun astro dev`): bun:sqlite
 *     opens the local `db/sohamhamso.db` file.
 *   - Edge runtime (Cloudflare Pages Function): `@libsql/client/web`
 *     talks to a Turso PII DB over HTTPS. Auth via env vars
 *     `TURSO_PII_URL` + `TURSO_PII_AUTH_TOKEN` (set as Cloudflare Pages
 *     secrets pre-launch — see `.env.example`).
 *
 * SCHEMA BOOTSTRAP:
 *   At the edge, the first request on a cold-start worker instance
 *   runs an idempotent `CREATE TABLE IF NOT EXISTS subscribers (...)`
 *   so a fresh Turso DB self-heals on first traffic. The bootstrap is
 *   memoized at module scope so it only fires once per worker instance.
 */

/**
 * Detect the runtime. `bun:sqlite` is only safe to import when we're in
 * the bun process — anywhere else (workerd, node-edge, browser) it must
 * not be referenced at all. `process.versions.bun` is the canonical
 * bun-only marker.
 */
function isBunRuntime(): boolean {
  return typeof process !== 'undefined' && typeof process.versions?.bun === 'string';
}

/**
 * Public surface every subscribe-DB backend exposes. The handler in
 * `src/pages/api/subscribe.ts` only ever sees this shape — never the
 * underlying driver. Both methods are async so the bun and libsql paths
 * are interchangeable.
 */
export interface SubscriberDb {
  insertSubscriber(row: {
    email_hash: string;
    language: string;
    region: 'us' | 'eu';
    unsubscribe_token: string;
    subscribed_at: string;
  }): Promise<void>;

  /**
   * True iff a row already exists for this (email_hash, language) pair.
   * Used as a fast-path; the canonical idempotency signal is still a
   * UNIQUE constraint violation on insert.
   */
  isAlreadySubscribed(email_hash: string, language: string): Promise<boolean>;
}

/**
 * Thrown by `insertSubscriber()` when the (email_hash, language) UNIQUE
 * constraint fires. The API handler catches this and returns the same
 * friendly 200 message as a fresh subscribe (idempotency + enumeration
 * defense in one).
 */
export class SubscriberUniqueViolation extends Error {
  constructor(message = 'subscriber already exists') {
    super(message);
    this.name = 'SubscriberUniqueViolation';
  }
}

/* ─────────────────────────────────────────────────────────────────────
 * Bun runtime backend (local dev + tests).
 *
 * `db/sohamhamso.db` is the same file the corpus reader uses; locally
 * we keep a single SQLite file (the `subscribers` table is part of the
 * same schema for dev simplicity — production splits it onto the Turso
 * PII DB).
 * ──────────────────────────────────────────────────────────────────── */

async function makeBunBackend(): Promise<SubscriberDb> {
  // DYNAMIC import — keeps `bun:sqlite` out of the edge bundle. The
  // bundler can't statically follow `await import(<string>)` of a bun
  // built-in, so the worker bundle never references it.
  // biome-ignore lint/correctness/noUndeclaredDependencies: bun built-in
  const { Database } = await import('bun:sqlite');
  const { existsSync } = await import('node:fs');
  const { dirname, resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  // Mirror the path resolution in `src/lib/db.ts` so dev opens the same
  // SQLite file the rest of the site reads from.
  function dbPath(): string {
    if (process.env.SOHAMHAMSO_DB_PATH) return process.env.SOHAMHAMSO_DB_PATH;
    const cwdPath = resolve(process.cwd(), 'db', 'sohamhamso.db');
    if (existsSync(cwdPath)) return cwdPath;
    const here = dirname(fileURLToPath(import.meta.url));
    return resolve(here, '..', '..', 'db', 'sohamhamso.db');
  }

  const db = new Database(dbPath());
  // WAL keeps the read-only corpus handle in `db.ts` happy alongside
  // this writer. Safe to set repeatedly.
  db.exec('PRAGMA journal_mode = WAL;');

  const insertStmt = db.prepare(
    `INSERT INTO subscribers
       (email_hash, language, subscribed_at, unsubscribe_token, region)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const existsStmt = db.prepare(
    `SELECT 1 AS one FROM subscribers
     WHERE email_hash = ? AND language = ?
     LIMIT 1`,
  );

  return {
    async insertSubscriber(row) {
      try {
        insertStmt.run(
          row.email_hash,
          row.language,
          row.subscribed_at,
          row.unsubscribe_token,
          row.region,
        );
      } catch (err) {
        if (isBunUniqueViolation(err)) {
          throw new SubscriberUniqueViolation();
        }
        throw err;
      }
    },
    async isAlreadySubscribed(email_hash, language) {
      const row = existsStmt.get(email_hash, language);
      return row != null;
    },
  };
}

// `bun:sqlite` SQLiteError shape — we only need the `code` field but
// fall back to message-sniff for wrappers that don't surface it.
function isBunUniqueViolation(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false;
  const e = err as { code?: unknown; message?: unknown };
  if (typeof e.code === 'string' && e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return true;
  }
  if (typeof e.message === 'string' && /UNIQUE constraint failed/i.test(e.message)) {
    return true;
  }
  return false;
}

/* ─────────────────────────────────────────────────────────────────────
 * Edge runtime backend (Cloudflare Pages Function → Turso over HTTPS).
 *
 * `@libsql/client/web` resolves to a workerd-safe build (no node:*).
 * Auth via env vars; both must be set as Cloudflare Pages secrets.
 * ──────────────────────────────────────────────────────────────────── */

// The `subscribers` schema, copy-pasted from `db/schema.sql` so a fresh
// Turso PII DB self-heals on first cold-start. Idempotent — re-runs are
// no-ops. If you'd rather run a one-shot via `turso db shell` instead,
// it's safe to remove this and document the manual step in `.env.example`.
//
// MUST be an array of single statements — libSQL HTTP `execute()` rejects
// multi-statement SQL with `SQL_MANY_STATEMENTS`. We apply via `batch()`
// (atomic, runs the whole bootstrap as one transaction) so a partial
// success on a fresh DB doesn't leave us with a table-without-index.
const SUBSCRIBERS_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email_hash TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'en',
    subscribed_at TEXT NOT NULL DEFAULT (datetime('now')),
    unsubscribe_token TEXT NOT NULL UNIQUE,
    region TEXT NOT NULL CHECK(region IN ('us','eu')),
    confirmed INTEGER NOT NULL DEFAULT 0 CHECK(confirmed IN (0,1)),
    confirmed_at TEXT,
    UNIQUE (email_hash, language)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_subscribers_email_hash ON subscribers(email_hash)`,
];

async function makeEdgeBackend(): Promise<SubscriberDb> {
  const url = process.env.TURSO_PII_URL;
  const authToken = process.env.TURSO_PII_AUTH_TOKEN;
  if (!url || url.length === 0) {
    throw new Error(
      'Server misconfigured: TURSO_PII_URL is not set. ' +
        'Set it as a Cloudflare Pages secret: ' +
        '`wrangler pages secret put TURSO_PII_URL --project sohamhamso`.',
    );
  }
  if (!authToken || authToken.length === 0) {
    throw new Error(
      'Server misconfigured: TURSO_PII_AUTH_TOKEN is not set. ' +
        'Set it as a Cloudflare Pages secret: ' +
        '`wrangler pages secret put TURSO_PII_AUTH_TOKEN --project sohamhamso`.',
    );
  }

  // The `/web` subpath is the workerd-safe entrypoint (verified via
  // @libsql/client package.json `exports` map: `workerd` → `web.js`).
  const { createClient } = await import('@libsql/client/web');
  const client = createClient({ url, authToken });

  // Cold-start bootstrap — first request on a fresh worker instance
  // ensures the subscribers table + index exist. Subsequent requests
  // on the same instance reuse the resolved promise (no extra round
  // trips). MUST use `batch()` not `execute()` because libSQL HTTP
  // rejects multi-statement SQL strings; the schema is 2 statements.
  await client.batch(SUBSCRIBERS_SCHEMA_STATEMENTS, 'deferred');

  return {
    async insertSubscriber(row) {
      try {
        await client.execute({
          sql: `INSERT INTO subscribers
                  (email_hash, language, subscribed_at, unsubscribe_token, region)
                VALUES (?, ?, ?, ?, ?)`,
          args: [
            row.email_hash,
            row.language,
            row.subscribed_at,
            row.unsubscribe_token,
            row.region,
          ],
        });
      } catch (err) {
        if (isLibsqlUniqueViolation(err)) {
          throw new SubscriberUniqueViolation();
        }
        throw err;
      }
    },
    async isAlreadySubscribed(email_hash, language) {
      const res = await client.execute({
        sql: `SELECT 1 AS one FROM subscribers
              WHERE email_hash = ? AND language = ?
              LIMIT 1`,
        args: [email_hash, language],
      });
      return res.rows.length > 0;
    },
  };
}

// libsql surfaces SQLite errors with a `code` like 'SQLITE_CONSTRAINT'
// and often a `proto.code` of 'SQLITE_CONSTRAINT_UNIQUE'; message also
// carries the human-readable constraint name. Match all three shapes
// defensively — the client lib has changed shape across minor versions.
function isLibsqlUniqueViolation(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false;
  const e = err as { code?: unknown; rawCode?: unknown; message?: unknown; proto?: unknown };
  if (typeof e.code === 'string' && /SQLITE_CONSTRAINT/.test(e.code)) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE' || e.code === 'SQLITE_CONSTRAINT') return true;
  }
  if (typeof e.message === 'string' && /UNIQUE constraint failed/i.test(e.message)) {
    return true;
  }
  if (e.proto != null && typeof e.proto === 'object') {
    const p = e.proto as { code?: unknown };
    if (typeof p.code === 'string' && /SQLITE_CONSTRAINT_UNIQUE|UNIQUE/.test(p.code)) return true;
  }
  return false;
}

/* ─────────────────────────────────────────────────────────────────────
 * Module-scope singleton + test injection hook.
 * ──────────────────────────────────────────────────────────────────── */

let _backendPromise: Promise<SubscriberDb> | null = null;
let _injected: SubscriberDb | null = null;

/**
 * Returns the singleton subscriber DB for this runtime. Memoizes the
 * factory promise so cold-start bootstrap (the libsql `CREATE TABLE`)
 * runs at most once per worker instance.
 *
 * Tests can pre-empt the routing by calling `__setSubscriberDbForTests`.
 */
export function getSubscriberDb(): Promise<SubscriberDb> {
  if (_injected) return Promise.resolve(_injected);
  if (_backendPromise) return _backendPromise;
  _backendPromise = isBunRuntime() ? makeBunBackend() : makeEdgeBackend();
  return _backendPromise;
}

/**
 * Test hook — inject a fake `SubscriberDb` implementation. Pass `null`
 * to clear and force the next `getSubscriberDb()` to re-resolve via the
 * normal runtime sniff. Production code MUST NOT call this.
 */
export function __setSubscriberDbForTests(db: SubscriberDb | null): void {
  _injected = db;
  if (db !== null) {
    // Drop any in-flight real backend so the test fake wins immediately.
    _backendPromise = null;
  }
}

/**
 * Runtime sniff — exported so the subscribe handler can apply the
 * "pepper must not be the dev fallback at the edge" guard without
 * duplicating the detection logic. Test hook also uses it.
 */
export function isEdgeRuntime(): boolean {
  return !isBunRuntime();
}
