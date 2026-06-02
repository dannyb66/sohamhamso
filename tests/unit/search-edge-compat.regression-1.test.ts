/**
 * Regression — production-launch-blocking bug (Agent 7, commit 00f7de1).
 *
 * The pre-launch edge audit found that `GET /api/search` was going to
 * 500 on the first request to Cloudflare Pages because the Worker
 * bundle statically pulled `bun:sqlite` (via
 * `src/pages/api/search.ts` → `src/lib/search.ts` → `src/lib/db.ts`).
 * The fix introduces `src/lib/corpus-db.ts` as a runtime-sniffed
 * factory that mirrors `src/lib/subscriber-db.ts`: bun-runtime
 * delegates to `db.ts` (via dynamic string-literal import), and
 * edge-runtime uses `@libsql/client/web` against the Turso CORPUS DB.
 *
 * This spec pins THREE invariants so the bug can't quietly come back:
 *
 *   1. `corpus-db.ts` exports the same factory shape as
 *      `subscriber-db.ts` — `getCorpusDb()`, `isEdgeRuntime()`, and a
 *      `__set*ForTests` injection hook. Shape parity is the contract
 *      the audit recommended for any future edge-runtime backend.
 *
 *   2. In the bun test process, `getCorpusDb()` returns a `CorpusDb`
 *      with both `all()` and `get()` methods, and BOTH return
 *      promises (so the search module's `await` shape works in
 *      either runtime without branching).
 *
 *   3. `@libsql/client/web` is importable on bare evaluation — same
 *      bundle-evaluation regression check used in
 *      `subscribe-edge-compat.test.ts`. If the `/web` subpath ever
 *      silently drops from the package exports map (or starts
 *      pulling `node:*` modules incompatible with workerd), this
 *      test fails loud BEFORE the broken bundle hits Cloudflare.
 *
 * Reference: `.gstack/launch/edge-audit-2026-06-01.md` §2a + §2c.
 */

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  type CorpusDb,
  __setCorpusDbForTests,
  getCorpusDb,
  isEdgeRuntime,
} from '../../src/lib/corpus-db';

// Point the bun backend at a throwaway SQLite file so this regression
// never touches the real corpus DB at `db/sohamhamso.db`. The corpus
// factory delegates to `db.ts`'s `getDb()`, which honors
// `SOHAMHAMSO_DB_PATH` first in its path-resolution order.
const tmpDbPath = join(mkdtempSync(join(tmpdir(), 'sohamhamso-corpus-edge-')), 'corpus.db');
const SCHEMA_PATH = resolve(__dirname, '..', '..', 'db', 'schema.sql');

const PRIOR_DB_PATH = process.env.SOHAMHAMSO_DB_PATH;

beforeAll(async () => {
  process.env.SOHAMHAMSO_DB_PATH = tmpDbPath;
  // Seed the schema so a `SELECT` against `verses` doesn't blow up
  // mid-test. Empty tables are fine — shape contract is what we test.
  // (Dynamic string-literal import — biome's noUndeclaredDependencies
  // only flags STATIC bun-builtin imports, so no suppression needed.)
  const { Database } = await import('bun:sqlite');
  const seed = new Database(tmpDbPath);
  seed.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  seed.close();
});

afterAll(async () => {
  // Drop the bun:sqlite handle held by db.ts so the temp file can be
  // garbage-collected and so the next test process starts clean.
  const { __setDbForTests } = await import('../../src/lib/db');
  __setDbForTests(null);
  if (PRIOR_DB_PATH === undefined) {
    // biome-ignore lint/performance/noDelete: env-var restore — required
    delete process.env.SOHAMHAMSO_DB_PATH;
  } else {
    process.env.SOHAMHAMSO_DB_PATH = PRIOR_DB_PATH;
  }
});

afterEach(() => {
  // Reset any per-test injection so subsequent tests run against the
  // real bun-runtime routing path.
  __setCorpusDbForTests(null);
});

describe('corpus-db — shape parity with subscriber-db', () => {
  it('exports getCorpusDb() and isEdgeRuntime() (mirrors subscriber-db public surface)', async () => {
    expect(typeof getCorpusDb).toBe('function');
    expect(typeof isEdgeRuntime).toBe('function');

    // Cross-reference: subscriber-db exports the same two symbols.
    // If either module drifts from this shape, the audit recommendation
    // ("any future writer-DB or any future module that needs to use
    // bun-only APIs in dev should copy this pattern verbatim") no
    // longer holds.
    const subscriberDb = await import('../../src/lib/subscriber-db');
    expect(typeof subscriberDb.getSubscriberDb).toBe('function');
    expect(typeof subscriberDb.isEdgeRuntime).toBe('function');
  });

  it('exposes a __setCorpusDbForTests injection hook (test-only)', async () => {
    const mod = await import('../../src/lib/corpus-db');
    expect(typeof mod.__setCorpusDbForTests).toBe('function');

    // Injection round-trip: a fake CorpusDb is returned by the next
    // getCorpusDb() call, then cleared on null.
    const fake: CorpusDb = {
      async all<T>() {
        return [] as T[];
      },
      async get<T>() {
        return undefined as T | undefined;
      },
    };
    mod.__setCorpusDbForTests(fake);
    await expect(getCorpusDb()).resolves.toBe(fake);

    mod.__setCorpusDbForTests(null);
    const real = await getCorpusDb();
    expect(real).not.toBe(fake);
    // After clearing, the real bun-runtime backend must surface the
    // CorpusDb shape (both verbs, both async).
    expect(typeof real.all).toBe('function');
    expect(typeof real.get).toBe('function');
  });
});

describe('corpus-db — bun runtime routing', () => {
  it('isEdgeRuntime() returns false in the bun test process', () => {
    // Inverse sanity check (matches subscribe-edge-compat.test.ts):
    // if this ever flips true under bun, both routing AND any
    // edge-only error gates misfire — every dev request would
    // either 500 on missing TURSO_CORPUS_URL or hit the libsql
    // path against an unconfigured client.
    expect(isEdgeRuntime()).toBe(false);
  });

  it('getCorpusDb() returns a CorpusDb with async all() + get() in bun runtime', async () => {
    const db = await getCorpusDb();
    expect(db).toBeDefined();
    expect(typeof db.all).toBe('function');
    expect(typeof db.get).toBe('function');

    // The async contract is load-bearing — search.ts awaits both
    // verbs. If the bun path accidentally returned a sync value,
    // the libsql path (genuinely async) would break shape parity
    // at the edge.
    const allProbe = db.all<{ id: number }>('SELECT 1 AS id');
    expect(allProbe).toBeInstanceOf(Promise);
    await expect(allProbe).resolves.toEqual([{ id: 1 }]);

    const getProbe = db.get<{ id: number }>('SELECT 2 AS id');
    expect(getProbe).toBeInstanceOf(Promise);
    await expect(getProbe).resolves.toEqual({ id: 2 });
  });

  it('get() returns undefined for an empty result (matches libsql contract)', async () => {
    const db = await getCorpusDb();
    // `verses` is seeded empty in beforeAll — any SELECT returns 0 rows.
    const row = await db.get<{ id: number }>('SELECT id FROM verses LIMIT 1');
    expect(row).toBeUndefined();
  });
});

describe('corpus-db — edge bundle dependency is importable', () => {
  it('@libsql/client/web import does not throw on bare evaluation', async () => {
    // Cheap regression for the bundle-evaluation failure mode:
    // even if we never CALL createClient in this test process, the
    // module must be importable. Mirror of
    // `subscribe-edge-compat.test.ts:104` so both edge backends are
    // covered by the same bundle-shape guarantee.
    const mod = await import('@libsql/client/web');
    expect(mod).toBeDefined();
    expect(typeof mod.createClient).toBe('function');
  });
});
