/** Subscriber persistence: local SQLite for development; bound Cloudflare D1 at the edge. No Turso runtime path. */

/**
 * Detect the runtime. `bun:sqlite` is only safe to import when we're in
 * the bun process — anywhere else (workerd, node-edge, browser) it must
 * not be referenced at all. `process.versions.bun` is the canonical
 * bun-only marker.
 */
import { resolveDbBackend } from './db-backend';

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
    email?: string;
    email_ciphertext?: string;
    email_nonce?: string;
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
  findSubscriber?(
    email_hash: string,
    language: string,
  ): Promise<{
    unsubscribe_token: string;
    confirmed: boolean;
  } | null>;
  markConfirmationDelivery?(token: string, sent: boolean): Promise<void>;
}

export type D1Database = {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      run(): Promise<unknown>;
      all<T>(): Promise<{ results: T[] }>;
    };
  };
};

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

function makeD1Backend(db: D1Database): SubscriberDb {
  return {
    async insertSubscriber(row) {
      try {
        await db
          .prepare(
            `INSERT INTO subscribers
               (email_hash, email, email_ciphertext, email_nonce, language, subscribed_at, unsubscribe_token, region)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            row.email_hash,
            row.email ?? null,
            row.email_ciphertext ?? null,
            row.email_nonce ?? null,
            row.language,
            row.subscribed_at,
            row.unsubscribe_token,
            row.region,
          )
          .run();
      } catch (err) {
        if (isD1UniqueViolation(err)) throw new SubscriberUniqueViolation();
        throw err;
      }
    },
    async isAlreadySubscribed(email_hash, language) {
      const result = await db
        .prepare('SELECT 1 AS one FROM subscribers WHERE email_hash = ? AND language = ? LIMIT 1')
        .bind(email_hash, language)
        .all<{ one: number }>();
      return result.results.length > 0;
    },
    async findSubscriber(email_hash, language) {
      const result = await db
        .prepare(
          'SELECT unsubscribe_token, confirmed FROM subscribers WHERE email_hash = ? AND language = ? LIMIT 1',
        )
        .bind(email_hash, language)
        .all<{ unsubscribe_token: string; confirmed: number }>();
      const row = result.results[0];
      return row
        ? { unsubscribe_token: row.unsubscribe_token, confirmed: row.confirmed === 1 }
        : null;
    },
    async markConfirmationDelivery(token, sent) {
      await db
        .prepare(
          sent
            ? "UPDATE subscribers SET email_sent_at = datetime('now'), email_failed_at = NULL WHERE unsubscribe_token = ?"
            : "UPDATE subscribers SET email_failed_at = datetime('now') WHERE unsubscribe_token = ?",
        )
        .bind(token)
        .run();
    },
  };
}

function isD1UniqueViolation(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false;
  const e = err as { code?: unknown; message?: unknown; cause?: unknown };
  if (typeof e.code === 'string' && /SQLITE_CONSTRAINT(?:_UNIQUE)?/.test(e.code)) return true;
  if (typeof e.message === 'string' && /UNIQUE constraint failed/i.test(e.message)) return true;
  if (e.cause != null && typeof e.cause === 'object') {
    const cause = e.cause as { message?: unknown };
    if (typeof cause.message === 'string' && /UNIQUE constraint failed/i.test(cause.message)) {
      return true;
    }
  }
  return false;
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
  const sqliteModule = ['bun', 'sqlite'].join(':');
  const { Database } = await import(/* @vite-ignore */ sqliteModule);
  const { existsSync } = await import('node:fs');
  const { dirname, resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  // Mirror the path resolution in `src/lib/db.ts` so dev opens the same
  // SQLite file the rest of the site reads from.
  function dbPath(): string {
    // Keep writable PII storage independently movable from the read-only
    // corpus file for a two-file self-hosted deployment.
    if (process.env.SOHAMHAMSO_PII_DB_PATH) return process.env.SOHAMHAMSO_PII_DB_PATH;
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
  bunSafeAlter(db, 'ALTER TABLE subscribers ADD COLUMN email_ciphertext TEXT;');
  bunSafeAlter(db, 'ALTER TABLE subscribers ADD COLUMN email_nonce TEXT;');
  bunSafeAlter(db, 'ALTER TABLE subscribers ADD COLUMN email TEXT;');
  bunSafeAlter(db, 'ALTER TABLE subscribers ADD COLUMN email_sent_at TEXT;');
  bunSafeAlter(db, 'ALTER TABLE subscribers ADD COLUMN email_failed_at TEXT;');

  const insertStmt = db.prepare(
    `INSERT INTO subscribers
       (email_hash, email, email_ciphertext, email_nonce, language, subscribed_at, unsubscribe_token, region)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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
          row.email ?? null,
          row.email_ciphertext ?? null,
          row.email_nonce ?? null,
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
    async findSubscriber(email_hash, language) {
      const row = db
        .prepare(
          'SELECT unsubscribe_token, confirmed FROM subscribers WHERE email_hash = ? AND language = ? LIMIT 1',
        )
        .get(email_hash, language) as { unsubscribe_token: string; confirmed: number } | null;
      return row
        ? { unsubscribe_token: row.unsubscribe_token, confirmed: row.confirmed === 1 }
        : null;
    },
    async markConfirmationDelivery(token, sent) {
      db.prepare(
        sent
          ? "UPDATE subscribers SET email_sent_at = datetime('now'), email_failed_at = NULL WHERE unsubscribe_token = ?"
          : "UPDATE subscribers SET email_failed_at = datetime('now') WHERE unsubscribe_token = ?",
      ).run(token);
    },
  };
}

// SQLite has no ADD COLUMN IF NOT EXISTS; local DBs may predate delivery fields.
// biome-ignore lint/suspicious/noExplicitAny: bun:sqlite Database is dynamically imported.
function bunSafeAlter(db: any, sql: string): void {
  try {
    db.exec(sql);
  } catch (error) {
    if (!(error instanceof Error) || !/duplicate column name/i.test(error.message)) throw error;
  }
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
export function getSubscriberDb(env?: { PII_DB?: D1Database }): Promise<SubscriberDb> {
  if (_injected) return Promise.resolve(_injected);
  if (_backendPromise) return _backendPromise;
  const backend = resolveDbBackend(process.env.SOHAMHAMSO_PII_DB_BACKEND, isBunRuntime());
  if (backend === 'sqlite') _backendPromise = makeBunBackend();
  else if (env?.PII_DB) _backendPromise = Promise.resolve(makeD1Backend(env.PII_DB));
  else
    _backendPromise = Promise.reject(
      new Error('Server misconfigured: PII_DB D1 binding is unavailable.'),
    );
  return _backendPromise;
}

/**
 * Test hook — inject a fake `SubscriberDb` implementation. Pass `null`
 * to clear and force the next `getSubscriberDb()` to re-resolve via the
 * normal runtime sniff. Production code MUST NOT call this.
 */
export function __setSubscriberDbForTests(db: SubscriberDb | null): void {
  _injected = db;
  // Drop any cached backend both when installing and clearing a fake so the
  // next test resolves from the environment it explicitly provides.
  _backendPromise = null;
}

/**
 * Runtime sniff — exported so the subscribe handler can apply the
 * "pepper must not be the dev fallback at the edge" guard without
 * duplicating the detection logic. Test hook also uses it.
 */
export function isEdgeRuntime(): boolean {
  return !isBunRuntime();
}
