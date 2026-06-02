/**
 * Subscriber confirm / unsubscribe DB helper — companion to
 * `src/lib/subscriber-db.ts`.
 *
 * WHY THIS FILE EXISTS (duplication is intentional):
 *   `subscriber-db.ts` exposes only `insertSubscriber()` +
 *   `isAlreadySubscribed()`. It does NOT expose the underlying client
 *   handle. The double-opt-in flow needs two more verbs:
 *
 *     - `confirmByToken(token)`: set `confirmed=1`, `confirmed_at=now`
 *       on the row whose `unsubscribe_token` matches. Idempotent — a
 *       re-confirm on an already-confirmed row succeeds with the same
 *       "confirmed" status.
 *
 *     - `deleteByToken(token)`: remove the row entirely. Matches the
 *       promise on `/about/privacy` ("Following it deletes your row from
 *       the subscribers database.").
 *
 *   Rather than mutate `subscriber-db.ts` (owned by another agent,
 *   per the scaffold contract), this file clones the bun-vs-edge
 *   routing pattern. The cost is one duplicated runtime sniff + one
 *   duplicated cold-start bootstrap. The benefit: zero coupling to
 *   the other file, zero risk of merge conflict.
 *
 *   FOLLOW-UP: when `subscriber-db.ts` gains these methods (or exposes
 *   its `.client` handle), delete this file and route the confirm /
 *   unsubscribe endpoints through `getSubscriberDb()` directly. The
 *   migration is mechanical — same return-types, same error shapes.
 *
 * COLD-START PARITY:
 *   The libsql `SUBSCRIBERS_SCHEMA` in `subscriber-db.ts` does NOT
 *   include `email_sent_at` / `email_failed_at` (added by the V1.x
 *   email-tracking migration — see `db/migrations/0001-add-email-tracking.sql`).
 *   This file's cold-start bootstrap runs idempotent ALTER TABLE
 *   statements in a try/catch that swallows "duplicate column"
 *   errors — so a freshly-deployed Turso PII DB self-heals to the
 *   migrated schema without a manual `turso db shell` step.
 *
 *   FOLLOW-UP: when consolidating into `subscriber-db.ts`, fold the
 *   ALTERs into its `SUBSCRIBERS_SCHEMA` so the cold-start is one
 *   round-trip instead of three.
 */

function isBunRuntime(): boolean {
  return typeof process !== 'undefined' && typeof process.versions?.bun === 'string';
}

/**
 * Public surface for confirm + unsubscribe verbs. Both methods are
 * async so the bun and libsql paths are interchangeable.
 *
 * RETURN SHAPE for `confirmByToken`:
 *   - `{ status: 'confirmed' }` — the row was found AND confirmed_at
 *     was just set (or was already set; idempotent re-confirm).
 *   - `{ status: 'unknown' }` — no row matches the token. The API
 *     handler MUST treat this as a soft failure (redirect with a quiet
 *     error param), not as enumeration evidence (no 404 leak).
 *
 * RETURN SHAPE for `deleteByToken`:
 *   - `{ deleted: true }` — a row matched and was removed.
 *   - `{ deleted: false }` — no row matched. Same enumeration-defense
 *     treatment as confirm — the handler MUST respond identically in
 *     both cases.
 */
export interface SubscriberConfirm {
  confirmByToken(token: string): Promise<{ status: 'confirmed' | 'unknown' }>;
  deleteByToken(token: string): Promise<{ deleted: boolean }>;
}

/* ─────────────────────────────────────────────────────────────────────
 * Bun runtime backend (local dev + tests).
 * ──────────────────────────────────────────────────────────────────── */

async function makeBunBackend(): Promise<SubscriberConfirm> {
  // DYNAMIC import — same rationale as in subscriber-db.ts (keeps
  // bun:sqlite out of the edge bundle). No biome-ignore needed: the
  // dynamic `await import(<string>)` form isn't flagged by
  // noUndeclaredDependencies, only the static `from 'bun:sqlite'` form is.
  const { Database } = await import('bun:sqlite');
  const { existsSync } = await import('node:fs');
  const { dirname, resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  function dbPath(): string {
    if (process.env.SOHAMHAMSO_DB_PATH) return process.env.SOHAMHAMSO_DB_PATH;
    const cwdPath = resolve(process.cwd(), 'db', 'sohamhamso.db');
    if (existsSync(cwdPath)) return cwdPath;
    const here = dirname(fileURLToPath(import.meta.url));
    return resolve(here, '..', '..', 'db', 'sohamhamso.db');
  }

  const db = new Database(dbPath());
  db.exec('PRAGMA journal_mode = WAL;');

  // Cold-start: add email-tracking columns if missing. SQLite has no
  // `ADD COLUMN IF NOT EXISTS`, so we run the ALTER and swallow the
  // "duplicate column" error. Safe to re-run on every cold start.
  bunSafeAlter(db, 'ALTER TABLE subscribers ADD COLUMN email_sent_at TEXT;');
  bunSafeAlter(db, 'ALTER TABLE subscribers ADD COLUMN email_failed_at TEXT;');

  const findStmt = db.prepare(
    'SELECT id, confirmed_at FROM subscribers WHERE unsubscribe_token = ? LIMIT 1',
  );
  const confirmStmt = db.prepare(
    `UPDATE subscribers
        SET confirmed = 1, confirmed_at = ?
      WHERE unsubscribe_token = ?`,
  );
  const deleteStmt = db.prepare('DELETE FROM subscribers WHERE unsubscribe_token = ?');

  return {
    async confirmByToken(token) {
      const row = findStmt.get(token) as { id: number; confirmed_at: string | null } | null;
      if (!row) return { status: 'unknown' };
      // Idempotent — re-confirming an already-confirmed row is a no-op
      // at the row level but still returns "confirmed" to the caller.
      if (row.confirmed_at) return { status: 'confirmed' };
      confirmStmt.run(new Date().toISOString(), token);
      return { status: 'confirmed' };
    },
    async deleteByToken(token) {
      const res = deleteStmt.run(token);
      // bun:sqlite's `run()` returns `{ changes, lastInsertRowid }`.
      const changes = (res as { changes?: number }).changes ?? 0;
      return { deleted: changes > 0 };
    },
  };
}

// biome-ignore lint/suspicious/noExplicitAny: bun:sqlite Database type is opaque here
function bunSafeAlter(db: any, sql: string): void {
  try {
    db.exec(sql);
  } catch (err) {
    if (!isDuplicateColumnError(err)) {
      throw err;
    }
  }
}

function isDuplicateColumnError(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false;
  const e = err as { message?: unknown };
  return typeof e.message === 'string' && /duplicate column name/i.test(e.message);
}

/* ─────────────────────────────────────────────────────────────────────
 * Edge runtime backend (Cloudflare Pages Function → Turso over HTTPS).
 * ──────────────────────────────────────────────────────────────────── */

async function makeEdgeBackend(): Promise<SubscriberConfirm> {
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

  const { createClient } = await import('@libsql/client/web');
  const client = createClient({ url, authToken });

  // Cold-start: add email-tracking columns if missing. Same idempotent
  // pattern as the bun backend — ALTER inside a try/catch that swallows
  // the "duplicate column" error libsql surfaces on re-runs.
  await libsqlSafeAlter(client, 'ALTER TABLE subscribers ADD COLUMN email_sent_at TEXT;');
  await libsqlSafeAlter(client, 'ALTER TABLE subscribers ADD COLUMN email_failed_at TEXT;');

  return {
    async confirmByToken(token) {
      const found = await client.execute({
        sql: 'SELECT id, confirmed_at FROM subscribers WHERE unsubscribe_token = ? LIMIT 1',
        args: [token],
      });
      if (found.rows.length === 0) return { status: 'unknown' };
      const row = found.rows[0] as unknown as { confirmed_at: string | null };
      if (row.confirmed_at) return { status: 'confirmed' };
      await client.execute({
        sql: 'UPDATE subscribers SET confirmed = 1, confirmed_at = ? WHERE unsubscribe_token = ?',
        args: [new Date().toISOString(), token],
      });
      return { status: 'confirmed' };
    },
    async deleteByToken(token) {
      const res = await client.execute({
        sql: 'DELETE FROM subscribers WHERE unsubscribe_token = ?',
        args: [token],
      });
      // libsql returns `rowsAffected: number | bigint` depending on
      // driver version; coerce defensively.
      const rowsAffected = Number(
        (res as unknown as { rowsAffected?: number | bigint }).rowsAffected ?? 0,
      );
      return { deleted: rowsAffected > 0 };
    },
  };
}

// biome-ignore lint/suspicious/noExplicitAny: libsql Client type is opaque here
async function libsqlSafeAlter(client: any, sql: string): Promise<void> {
  try {
    await client.execute(sql);
  } catch (err) {
    if (!isLibsqlDuplicateColumnError(err)) {
      throw err;
    }
  }
}

function isLibsqlDuplicateColumnError(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false;
  const e = err as { code?: unknown; message?: unknown; proto?: unknown };
  if (typeof e.message === 'string' && /duplicate column name/i.test(e.message)) return true;
  // libsql wraps the SQLite error in a typed `code` on some versions.
  if (typeof e.code === 'string' && /SQLITE_ERROR/.test(e.code)) {
    // Fall through to message inspection above; if that didn't catch
    // it, the error is something else and the caller should re-throw.
    return false;
  }
  if (e.proto != null && typeof e.proto === 'object') {
    const p = e.proto as { message?: unknown };
    if (typeof p.message === 'string' && /duplicate column name/i.test(p.message)) return true;
  }
  return false;
}

/* ─────────────────────────────────────────────────────────────────────
 * Module-scope singleton + test injection hook.
 * ──────────────────────────────────────────────────────────────────── */

let _backendPromise: Promise<SubscriberConfirm> | null = null;
let _injected: SubscriberConfirm | null = null;

export function getSubscriberConfirm(): Promise<SubscriberConfirm> {
  if (_injected) return Promise.resolve(_injected);
  if (_backendPromise) return _backendPromise;
  _backendPromise = isBunRuntime() ? makeBunBackend() : makeEdgeBackend();
  return _backendPromise;
}

/**
 * Test hook — inject a fake `SubscriberConfirm` implementation. Pass
 * `null` to clear and force the next `getSubscriberConfirm()` to
 * re-resolve via the normal runtime sniff. Production code MUST NOT
 * call this.
 */
export function __setSubscriberConfirmForTests(impl: SubscriberConfirm | null): void {
  _injected = impl;
  if (impl !== null) {
    _backendPromise = null;
  }
}

/**
 * Token shape per `generateUnsubscribeToken()` in subscribe.ts —
 * 32 base64url chars (24 random bytes, no padding). Exported so the
 * confirm + unsubscribe endpoints can reject malformed tokens BEFORE
 * touching the DB.
 */
export const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
