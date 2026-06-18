#!/usr/bin/env bun
/**
 * sohamhamso — seed the materialized `lemma_index` table to Turso.
 *
 * WHY A DEDICATED SCRIPT (not scripts/turso-seed-corpus.ts): that seeder is
 * per-TEXT scoped with content checksums. `lemma_index` is corpus-WIDE and
 * DERIVED — a lemma's slug and occurrence_count depend on the whole corpus,
 * so it can't be seeded one text at a time. This script does an idempotent
 * FULL REPLACE: clear the remote table, then batch-insert every row from the
 * local build-time `lemma_index` (populated by pipeline/ingest/lemma-index.ts
 * during `bun run db:build`).
 *
 * It is small (~15k rows) and cheap. Run it on every deploy AFTER all texts
 * are present locally, and AFTER `bun pipeline/ingest/migrations.ts --turso`
 * has created the table remotely.
 *
 * Env (source .env.production.local first):
 *   TURSO_CORPUS_URL
 *   TURSO_CORPUS_AUTH_TOKEN
 *   SOHAMHAMSO_DB_PATH      (default db/sohamhamso.db)
 *   TURSO_SEED_BATCH_SIZE   (default 200)
 *
 * Run:
 *   set -a && source .env.production.local && set +a
 *   bun scripts/turso-seed-lemma-index.ts
 */

import { Database } from 'bun:sqlite';
import { resolve } from 'node:path';
import { type Client, type InValue, createClient } from '@libsql/client/web';

export interface LemmaIndexRow {
  lemma_iast: string;
  slug: string;
  occurrence_count: number;
}

export const LEMMA_INDEX_DELETE_ALL = 'DELETE FROM lemma_index';

const LEMMA_INDEX_INSERT =
  'INSERT INTO lemma_index (lemma_iast, slug, occurrence_count) VALUES (?, ?, ?)';

/** Map local lemma_index rows to parameterized libSQL INSERT statements. */
export function lemmaIndexInsertStatements(
  rows: ReadonlyArray<LemmaIndexRow>,
): Array<{ sql: string; args: InValue[] }> {
  return rows.map((r) => ({
    sql: LEMMA_INDEX_INSERT,
    args: [r.lemma_iast, r.slug, r.occurrence_count] as InValue[],
  }));
}

function chunk<T>(items: ReadonlyArray<T>, size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function die(msg: string): never {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const TURSO_URL = process.env.TURSO_CORPUS_URL;
  const TURSO_TOKEN = process.env.TURSO_CORPUS_AUTH_TOKEN;
  const DB_PATH = resolve(process.env.SOHAMHAMSO_DB_PATH ?? 'db/sohamhamso.db');
  const BATCH_SIZE = Number(process.env.TURSO_SEED_BATCH_SIZE ?? '200');

  if (!TURSO_URL) die('TURSO_CORPUS_URL not set (source .env.production.local first).');
  if (!TURSO_TOKEN) die('TURSO_CORPUS_AUTH_TOKEN not set (source .env.production.local first).');
  if (!Number.isInteger(BATCH_SIZE) || BATCH_SIZE < 1 || BATCH_SIZE > 500) {
    die(`TURSO_SEED_BATCH_SIZE must be an integer in [1, 500], got ${BATCH_SIZE}`);
  }

  const local = new Database(DB_PATH, { readonly: true });
  const rows = local
    .query<LemmaIndexRow, []>(
      'SELECT lemma_iast, slug, occurrence_count FROM lemma_index ORDER BY lemma_iast',
    )
    .all();
  local.close();

  if (rows.length === 0) {
    die('Local lemma_index is empty — run `bun run db:build` first.');
  }

  console.log(`Local  : ${DB_PATH}`);
  console.log(`Remote : ${TURSO_URL}`);
  console.log(`Rows   : ${rows.length} lemmas`);
  console.log(`Batch  : ${BATCH_SIZE}`);

  const turso: Client = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });

  // Full replace: clear, then insert in batched write transactions.
  await turso.execute(LEMMA_INDEX_DELETE_ALL);
  const stmts = lemmaIndexInsertStatements(rows);
  let written = 0;
  for (const part of chunk(stmts, BATCH_SIZE)) {
    await turso.batch(part, 'write');
    written += part.length;
    console.log(`  …${written}/${rows.length}`);
  }

  // Verify: remote count must match local.
  const remote = await turso.execute('SELECT count(*) AS n FROM lemma_index');
  const remoteCount = Number((remote.rows[0] as unknown as { n: number }).n);
  if (remoteCount !== rows.length) {
    die(`Verification failed: local ${rows.length} != remote ${remoteCount}`);
  }
  console.log(`✓ lemma_index seeded: ${remoteCount} rows (count-verified)`);
}

if (import.meta.main) {
  main().catch((err) => die(err instanceof Error ? err.message : String(err)));
}
