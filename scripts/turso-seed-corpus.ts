#!/usr/bin/env bun
/**
 * turso-seed-corpus.ts — HTTP-mode corpus seeder.
 *
 * Companion to scripts/turso-apply-schema-http.ts. After the schema has
 * been applied to the production Turso corpus DB, this script pushes
 * Phase 1 corpus rows from the local `db/sohamhamso.db` into Turso via
 * libSQL HTTP batch inserts.
 *
 * Seeds (FK-correct order):
 *   1. texts          (parent rows)
 *   2. verses         (FK → texts)
 *   3. translations   (FK → verses)
 *   4. word_glosses   (FK → verses)
 *   5. parallels      (FK → verses)
 *
 * Primary keys are preserved explicitly so cross-table FKs continue to
 * resolve. Idempotent via INSERT OR IGNORE — re-runs against a populated
 * DB are no-ops at the row level.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   bun scripts/turso-seed-corpus.ts
 *
 * Required env:
 *   TURSO_CORPUS_URL
 *   TURSO_CORPUS_AUTH_TOKEN
 *
 * Optional env:
 *   SOHAMHAMSO_DB_PATH (defaults to db/sohamhamso.db relative to cwd)
 *   TURSO_SEED_BATCH_SIZE (default 200)
 */
// biome-ignore lint/correctness/noUndeclaredDependencies: bun built-in
import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Client, type InValue, createClient } from '@libsql/client/web';

// ─────────────────────────────────────────────────────────────────────────────
// Config / pre-flight
// ─────────────────────────────────────────────────────────────────────────────

const TURSO_URL = process.env.TURSO_CORPUS_URL;
const TURSO_TOKEN = process.env.TURSO_CORPUS_AUTH_TOKEN;
const DB_PATH = resolve(process.env.SOHAMHAMSO_DB_PATH ?? 'db/sohamhamso.db');
const BATCH_SIZE = Number(process.env.TURSO_SEED_BATCH_SIZE ?? '200');

function die(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

if (!TURSO_URL) die('TURSO_CORPUS_URL not set (source .env.production.local first).');
if (!TURSO_TOKEN) die('TURSO_CORPUS_AUTH_TOKEN not set (source .env.production.local first).');
if (!existsSync(DB_PATH)) die(`Local SQLite not found at ${DB_PATH}`);
if (!Number.isInteger(BATCH_SIZE) || BATCH_SIZE < 1 || BATCH_SIZE > 500) {
  die(`TURSO_SEED_BATCH_SIZE must be an integer in [1, 500], got ${BATCH_SIZE}`);
}

const redactedToken = `${TURSO_TOKEN.slice(0, 5)}...${TURSO_TOKEN.slice(-5)}`;
console.log(`Source : ${DB_PATH}`);
console.log(`Target : ${TURSO_URL}`);
console.log(`Token  : ${redactedToken}`);
console.log(`Batch  : ${BATCH_SIZE}`);
console.log('');

// ─────────────────────────────────────────────────────────────────────────────
// Open both DBs
// ─────────────────────────────────────────────────────────────────────────────

const local = new Database(DB_PATH, { readonly: true });
local.exec('PRAGMA query_only = ON;');

const turso: Client = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Count rows in a table on the local SQLite. */
function localCount(table: string): number {
  const row = local.query<{ n: number }, []>(`SELECT count(*) AS n FROM ${table}`).get();
  return row?.n ?? 0;
}

/** Count rows in a table on Turso. INTEGER results may come back as BigInt — cast. */
async function tursoCount(table: string): Promise<number> {
  const res = await turso.execute(`SELECT count(*) AS n FROM ${table}`);
  const raw = res.rows[0]?.n;
  return Number(raw ?? 0);
}

/**
 * Convert a column value pulled from bun:sqlite into a libSQL `InValue`.
 * bun:sqlite returns native JS types (string|number|bigint|null|Uint8Array).
 * libSQL accepts the same set; we just pass through. JS `undefined` (which
 * bun:sqlite does not produce for a present column) gets coerced to null.
 */
function asArg(v: unknown): InValue {
  if (v === undefined) return null;
  // bun:sqlite returns Buffer for BLOB; libSQL wants Uint8Array.
  if (v instanceof Uint8Array) return v;
  return v as InValue;
}

/**
 * Build (sql, args) pairs for a list of rows where the SQL is a single
 * parameterized INSERT OR IGNORE with `?` placeholders for `columns`.
 */
function buildInserts(
  table: string,
  columns: string[],
  rows: Array<Record<string, unknown>>,
): Array<{ sql: string; args: InValue[] }> {
  const placeholders = columns.map(() => '?').join(', ');
  const sql = `INSERT OR IGNORE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;
  return rows.map((row) => ({
    sql,
    args: columns.map((c) => asArg(row[c])),
  }));
}

/**
 * Stream rows from a local SELECT in chunks of BATCH_SIZE and push each
 * chunk as a single libSQL `batch()` call. Returns total rows attempted
 * and total rowsAffected reported by Turso (sum over all statements).
 */
async function seedTable(
  table: string,
  columns: string[],
  orderBy: string,
): Promise<{ attempted: number; affected: number }> {
  const total = localCount(table);
  if (total === 0) {
    console.log(`[${table}] 0 rows (skip)`);
    return { attempted: 0, affected: 0 };
  }

  const stmt = local.query<Record<string, unknown>, []>(
    `SELECT ${columns.join(', ')} FROM ${table} ORDER BY ${orderBy}`,
  );
  const rows = stmt.all();

  let attempted = 0;
  let affected = 0;
  const batches = Math.ceil(rows.length / BATCH_SIZE);
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const stmts = buildInserts(table, columns, chunk);
    const results = await turso.batch(stmts, 'write');
    for (const r of results) {
      affected += Number(r.rowsAffected ?? 0);
    }
    attempted += chunk.length;
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    console.log(
      `  [${table} ${batchNum}/${batches}] +${chunk.length} (running ${attempted}/${total}) ✓`,
    );
  }
  return { attempted, affected };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pre-flight: target tables must be empty
// ─────────────────────────────────────────────────────────────────────────────

const SEED_TABLES = ['texts', 'verses', 'translations', 'word_glosses', 'parallels'] as const;

console.log('Pre-flight: verifying Turso target is empty for seeded tables...');
const preCounts: Record<string, number> = {};
for (const t of SEED_TABLES) {
  preCounts[t] = await tursoCount(t);
  console.log(`  ${t}: ${preCounts[t]}`);
}
const nonEmpty = SEED_TABLES.filter((t) => preCounts[t] > 0);
if (nonEmpty.length > 0) {
  die(
    `Target DB is not empty for: ${nonEmpty.join(', ')}. ` +
      `Refusing to seed — clear these tables manually if a re-seed is intended.`,
  );
}
console.log('  ✓ all seeded tables empty\n');

// ─────────────────────────────────────────────────────────────────────────────
// Seed in FK-correct order
// ─────────────────────────────────────────────────────────────────────────────

const TEXTS_COLS = [
  'id',
  'slug',
  'title_sa',
  'title_en',
  'title_iast',
  'author',
  'tradition',
  'school',
  'era',
  'source',
  'source_url',
  'source_revision',
  'license',
  'attribution_html',
  'parent_text_id',
  'manuscript_url',
  'description',
  'created_at',
  'updated_at',
];

const VERSES_COLS = [
  'id',
  'text_id',
  'book',
  'chapter',
  'verse_num',
  'devanagari',
  'slp1',
  'iast',
  'meter',
  'manuscript_folio_ref',
  'created_at',
];

const TRANSLATIONS_COLS = [
  'id',
  'verse_id',
  'lang',
  'translator',
  'translation_text',
  'source',
  'license',
  'status',
  'ai_assisted',
  'model',
  'model_version',
  'prompt_version',
  'judge_score',
  'reviewer',
  'reviewed_at',
  'created_at',
  'updated_at',
];

const WORD_GLOSSES_COLS = [
  'id',
  'verse_id',
  'word_idx',
  'word_sa',
  'lemma_sa',
  'lemma_iast',
  'gloss_lang',
  'gloss_text',
  'morph',
  'created_at',
];

const PARALLELS_COLS = [
  'id',
  'source_verse_id',
  'target_verse_id',
  'citation_type',
  'confidence',
  'extracted_by',
  'created_at',
];

const t0 = Date.now();

// Ordering note: texts has a self-FK (parent_text_id REFERENCES texts(id)).
// Phase 1 corpus has no parent rows (verified pre-flight), so any order works.
// We order by id ASC for deterministic output. If parent rows are ever added,
// switch to `parent_text_id IS NULL DESC, id ASC` to insert parents first.
const r1 = await seedTable('texts', TEXTS_COLS, 'id ASC');
const r2 = await seedTable('verses', VERSES_COLS, 'id ASC');
const r3 = await seedTable('translations', TRANSLATIONS_COLS, 'id ASC');
const r4 = await seedTable('word_glosses', WORD_GLOSSES_COLS, 'id ASC');
const r5 = await seedTable('parallels', PARALLELS_COLS, 'id ASC');

const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);

// ─────────────────────────────────────────────────────────────────────────────
// Verification
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nVerification — comparing Turso row counts to local source:');
const results: Record<string, { attempted: number; affected: number }> = {
  texts: r1,
  verses: r2,
  translations: r3,
  word_glosses: r4,
  parallels: r5,
};

let mismatches = 0;
for (const t of SEED_TABLES) {
  const lc = localCount(t);
  const tc = await tursoCount(t);
  const mark = lc === tc ? '✓' : 'ERROR';
  const r = results[t];
  const skipped = r ? r.attempted - r.affected : 0;
  const skipNote = skipped > 0 ? ` (${skipped} skipped via INSERT OR IGNORE)` : '';
  console.log(`  ${mark} ${t}: local=${lc} turso=${tc}${skipNote}`);
  if (lc !== tc) mismatches += 1;
}

console.log(`\nElapsed: ${elapsedSec}s`);

if (mismatches > 0) {
  console.error(`\n✗ ${mismatches} table(s) had row-count mismatch.`);
  process.exit(2);
}
console.log('\n✓ all seeded tables match local source. Done.');
process.exit(0);
