/** Subscriber confirmation and unsubscribe: local SQLite or bound Cloudflare D1. No Turso runtime path. */

import { resolveDbBackend } from './db-backend';
import type { D1Database } from './subscriber-db';

function isBunRuntime(): boolean {
  return typeof process !== 'undefined' && typeof process.versions?.bun === 'string';
}

/**
 * Public surface for confirm + unsubscribe verbs. Both methods are
 * async so the SQLite and D1 paths are interchangeable.
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

function makeD1Backend(db: D1Database): SubscriberConfirm {
  return {
    async confirmByToken(token) {
      const result = await db
        .prepare(
          "UPDATE subscribers SET confirmed = 1, confirmed_at = COALESCE(confirmed_at, datetime('now')) WHERE unsubscribe_token = ?",
        )
        .bind(token)
        .run();
      const changes = (result as { meta?: { changes?: number } }).meta?.changes ?? 0;
      return { status: changes > 0 ? 'confirmed' : 'unknown' };
    },
    async deleteByToken(token) {
      const result = await db
        .prepare('DELETE FROM subscribers WHERE unsubscribe_token = ?')
        .bind(token)
        .run();
      const changes = (result as { meta?: { changes?: number } }).meta?.changes ?? 0;
      return { deleted: changes > 0 };
    },
  };
}

/* ─────────────────────────────────────────────────────────────────────
 * Bun runtime backend (local dev + tests).
 * ──────────────────────────────────────────────────────────────────── */

async function makeBunBackend(): Promise<SubscriberConfirm> {
  // DYNAMIC import — same rationale as in subscriber-db.ts (keeps
  // bun:sqlite out of the edge bundle). No biome-ignore needed: the
  // dynamic `await import(<string>)` form isn't flagged by
  // noUndeclaredDependencies, only the static `from 'bun:sqlite'` form is.
  const sqliteModule = ['bun', 'sqlite'].join(':');
  const { Database } = await import(/* @vite-ignore */ sqliteModule);
  const { existsSync } = await import('node:fs');
  const { dirname, resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  function dbPath(): string {
    // Confirmation/unsubscribe writes must follow the same isolated PII
    // file as the subscribe writer in a self-hosted deployment.
    if (process.env.SOHAMHAMSO_PII_DB_PATH) return process.env.SOHAMHAMSO_PII_DB_PATH;
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
  bunSafeAlter(db, 'ALTER TABLE subscribers ADD COLUMN email TEXT;');

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
 * Module-scope singleton + test injection hook.
 * ──────────────────────────────────────────────────────────────────── */

let _backendPromise: Promise<SubscriberConfirm> | null = null;
let _injected: SubscriberConfirm | null = null;

export function getSubscriberConfirm(env?: { PII_DB?: D1Database }): Promise<SubscriberConfirm> {
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
 * Test hook — inject a fake `SubscriberConfirm` implementation. Pass
 * `null` to clear and force the next `getSubscriberConfirm()` to
 * re-resolve via the normal runtime sniff. Production code MUST NOT
 * call this.
 */
export function __setSubscriberConfirmForTests(impl: SubscriberConfirm | null): void {
  _injected = impl;
  _backendPromise = null;
}

/**
 * Token shape per `generateUnsubscribeToken()` in subscribe.ts —
 * 32 base64url chars (24 random bytes, no padding). Exported so the
 * confirm + unsubscribe endpoints can reject malformed tokens BEFORE
 * touching the DB.
 */
export const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
