/** Local async corpus adapter contracts. Edge readers use generated assets. */

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
    expect(isEdgeRuntime()).toBe(false);
  });

  it('getCorpusDb() returns a CorpusDb with async all() + get() in bun runtime', async () => {
    const db = await getCorpusDb();
    expect(db).toBeDefined();
    expect(typeof db.all).toBe('function');
    expect(typeof db.get).toBe('function');

    // The async contract is load-bearing — search.ts awaits both
    // verbs. If the bun path accidentally returned a sync value,
    // callers would lose the documented asynchronous API.
    const allProbe = db.all<{ id: number }>('SELECT 1 AS id');
    expect(allProbe).toBeInstanceOf(Promise);
    await expect(allProbe).resolves.toEqual([{ id: 1 }]);

    const getProbe = db.get<{ id: number }>('SELECT 2 AS id');
    expect(getProbe).toBeInstanceOf(Promise);
    await expect(getProbe).resolves.toEqual({ id: 2 });
  });

  it('get() returns undefined for an empty result (async adapter contract)', async () => {
    const db = await getCorpusDb();
    // `verses` is seeded empty in beforeAll — any SELECT returns 0 rows.
    const row = await db.get<{ id: number }>('SELECT id FROM verses LIMIT 1');
    expect(row).toBeUndefined();
  });
});
