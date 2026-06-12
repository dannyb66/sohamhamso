#!/usr/bin/env bun
/**
 * turso-seed-corpus.ts — HTTP-mode corpus seeder.
 *
 * Companion to scripts/turso-apply-schema-http.ts. After the schema has
 * been applied to the production Turso corpus DB, this script pushes
 * corpus rows from the local `db/sohamhamso.db` into Turso via libSQL
 * HTTP batch inserts.
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
 * Modes:
 *   (no flags)                  Full-DB legacy mode. Refuses unless every
 *                               seeded table is empty on the target.
 *   --text <slug>               Seed only rows belonging to one text. The
 *                               pre-flight checks per-text emptiness on the
 *                               target (not global emptiness), so a new text
 *                               can be seeded into a populated prod DB.
 *   --text <slug> --replace     DELETE the text's existing remote rows in
 *                               FK-safe order, then seed. This doubles as the
 *                               rollback procedure: restore the last-good
 *                               local DB, then run `--text <slug> --replace`.
 *   --text <slug> --delete-only Remove the text's remote rows without
 *                               re-seeding (pure rollback / delete mode).
 *
 * Safety: --replace and --delete-only refuse to run without
 * --backup-confirmed. Take a fresh backup via the turso-backup.yml
 * workflow before passing it.
 *
 * Verification: after seeding, a per-table SHA-256 checksum over natural
 * keys + content columns (AUTOINCREMENT ids excluded — they drift across
 * local DB rebuilds) is compared between local and remote for the seeded
 * scope. Stale remote rows that INSERT OR IGNORE silently kept are caught
 * and reported with a key-level diff; any mismatch exits nonzero.
 *
 * Prerequisite: db/sohamhamso.db is NOT committed (plan item A6 — it is a
 * build cache reconstructed from data/corpus/*.yaml). Build it first:
 *   bun run db:build        # db:init + ingest
 * Seeding prod should always start from a deliberate, fresh local ingest —
 * this script refuses to auto-build the DB for you.
 *
 * Usage:
 *   bun run db:build
 *   set -a; source .env.production.local; set +a
 *   bun scripts/turso-seed-corpus.ts [--text <slug>] [--replace | --delete-only] [--backup-confirmed]
 *
 * Required env:
 *   TURSO_CORPUS_URL
 *   TURSO_CORPUS_AUTH_TOKEN
 *
 * Optional env:
 *   SOHAMHAMSO_DB_PATH (defaults to db/sohamhamso.db relative to cwd)
 *   TURSO_SEED_BATCH_SIZE (default 200)
 */
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Client, type InValue, createClient } from '@libsql/client/web';

// ─────────────────────────────────────────────────────────────────────────────
// CLI parsing (pure — unit tested)
// ─────────────────────────────────────────────────────────────────────────────

export const BACKUP_WORKFLOW = '.github/workflows/turso-backup.yml';

export interface CliOptions {
  /** Text slug to scope the run to; null = full-DB legacy mode. */
  textSlug: string | null;
  /** Delete the text's remote rows before seeding (requires --text). */
  replace: boolean;
  /** Delete the text's remote rows and stop — no seeding (requires --text). */
  deleteOnly: boolean;
  /** Operator confirms a fresh backup exists (required for destructive ops). */
  backupConfirmed: boolean;
}

/**
 * Parse and validate CLI flags. Throws Error (not process.exit) so the
 * combination rules are unit-testable; main() converts throws to die().
 */
export function parseCliArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    textSlug: null,
    replace: false,
    deleteOnly: false,
    backupConfirmed: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--text') {
      const slug = argv[i + 1];
      if (!slug || slug.startsWith('--')) throw new Error('--text requires a <slug> argument.');
      opts.textSlug = slug;
      i++;
    } else if (arg === '--replace') {
      opts.replace = true;
    } else if (arg === '--delete-only') {
      opts.deleteOnly = true;
    } else if (arg === '--backup-confirmed') {
      opts.backupConfirmed = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (opts.replace && opts.deleteOnly) {
    throw new Error('--replace and --delete-only are mutually exclusive.');
  }
  if (opts.replace && !opts.textSlug) {
    throw new Error('--replace requires --text <slug> (full-DB replace is not supported).');
  }
  if (opts.deleteOnly && !opts.textSlug) {
    throw new Error('--delete-only requires --text <slug>.');
  }
  if ((opts.replace || opts.deleteOnly) && !opts.backupConfirmed) {
    throw new Error(
      `Destructive operation (${opts.replace ? '--replace' : '--delete-only'}) refused: ` +
        `pass --backup-confirmed after taking a fresh backup via the ${BACKUP_WORKFLOW} workflow.`,
    );
  }
  return opts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Table specs + SQL planning (pure — unit tested)
// ─────────────────────────────────────────────────────────────────────────────

export const SEED_TABLES = [
  'texts',
  'verses',
  'translations',
  'word_glosses',
  'parallels',
] as const;
export type SeedTable = (typeof SEED_TABLES)[number];

export interface TableSpec {
  table: SeedTable;
  /** Insert columns (explicit ids preserved so cross-table FKs resolve). */
  columns: string[];
  /** Deterministic export order for batching. */
  orderBy: string;
  /** WHERE clause scoping rows to one text; `?` binds text_id `scopedArgCount` times. */
  scopedWhere: string;
  scopedArgCount: number;
}

const VERSES_OF_TEXT = '(SELECT id FROM verses WHERE text_id = ?)';

export const TABLE_SPECS: TableSpec[] = [
  {
    table: 'texts',
    columns: [
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
    ],
    // Ordering note: texts has a self-FK (parent_text_id REFERENCES texts(id)).
    // Insert parents first so child rows resolve when parent rows exist.
    orderBy: 'parent_text_id IS NULL DESC, id ASC',
    scopedWhere: 'id = ?',
    scopedArgCount: 1,
  },
  {
    table: 'verses',
    columns: [
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
    ],
    orderBy: 'id ASC',
    scopedWhere: 'text_id = ?',
    scopedArgCount: 1,
  },
  {
    table: 'translations',
    columns: [
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
    ],
    orderBy: 'id ASC',
    scopedWhere: `verse_id IN ${VERSES_OF_TEXT}`,
    scopedArgCount: 1,
  },
  {
    table: 'word_glosses',
    columns: [
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
    ],
    orderBy: 'id ASC',
    scopedWhere: `verse_id IN ${VERSES_OF_TEXT}`,
    scopedArgCount: 1,
  },
  {
    // Scope note: a parallel belongs to the text if either endpoint verse
    // does. Cross-text parallels seed only when the other text's verses are
    // already present remotely; otherwise the content checksum flags them.
    table: 'parallels',
    columns: [
      'id',
      'source_verse_id',
      'target_verse_id',
      'citation_type',
      'confidence',
      'extracted_by',
      'created_at',
    ],
    orderBy: 'id ASC',
    scopedWhere: `source_verse_id IN ${VERSES_OF_TEXT} OR target_verse_id IN ${VERSES_OF_TEXT}`,
    scopedArgCount: 2,
  },
];

/** SELECT pulling the rows to seed; scoped by text_id when `scoped`. */
export function seedSelectSql(spec: TableSpec, scoped: boolean): string {
  const where = scoped ? ` WHERE ${spec.scopedWhere}` : '';
  return `SELECT ${spec.columns.join(', ')} FROM ${spec.table}${where} ORDER BY ${spec.orderBy}`;
}

/** count(*) for the seeded scope; scoped by text_id when `scoped`. */
export function countSql(spec: TableSpec, scoped: boolean): string {
  const where = scoped ? ` WHERE ${spec.scopedWhere}` : '';
  return `SELECT count(*) AS n FROM ${spec.table}${where}`;
}

/** Bind text_id the number of times the spec's WHERE clause expects. */
export function scopedArgs(spec: TableSpec, textId: string): string[] {
  return Array(spec.scopedArgCount).fill(textId);
}

/**
 * DELETE statements removing one text's rows in FK-safe (children-first)
 * order. Used by --replace and --delete-only; running these from a
 * last-good local DB is the documented rollback procedure.
 */
export function buildDeleteStatements(textId: string): Array<{ sql: string; args: string[] }> {
  const ordered: SeedTable[] = ['parallels', 'word_glosses', 'translations', 'verses', 'texts'];
  return ordered.map((table) => {
    const spec = TABLE_SPECS.find((s) => s.table === table) as TableSpec;
    return {
      sql: `DELETE FROM ${spec.table} WHERE ${spec.scopedWhere}`,
      args: scopedArgs(spec, textId),
    };
  });
}

/**
 * Build (sql, args) pairs for a list of rows where the SQL is a single
 * parameterized INSERT OR IGNORE with `?` placeholders for `columns`.
 */
export function buildInserts(
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

/** Split an array into chunks of at most `size`. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Content verification (pure — unit tested)
//
// Row counts are not enough: INSERT OR IGNORE + explicit AUTOINCREMENT ids
// can leave stale remote rows after a local DB rebuild while counts still
// match. Instead we checksum natural keys + content columns, resolving id
// FKs to natural keys via joins so the comparison is id-independent.
// Volatile created_at/updated_at timestamps are excluded.
// ─────────────────────────────────────────────────────────────────────────────

export interface VerifySpec {
  table: SeedTable;
  /** SELECT projecting natural key + content columns (same SQL on both DBs). */
  sql: string;
  /** WHERE clause scoping to one text slug; `?` binds slug `scopedArgCount` times. */
  scopedWhere: string;
  scopedArgCount: number;
  /** Natural-key columns within the projection (for diff reporting). */
  keyCols: string[];
  /** All projected columns, in checksum order. */
  cols: string[];
}

export const VERIFY_SPECS: VerifySpec[] = [
  {
    table: 'texts',
    sql:
      'SELECT t.slug, t.title_sa, t.title_en, t.title_iast, t.author, t.tradition, ' +
      't.school, t.era, t.source, t.source_url, t.source_revision, t.license, ' +
      't.attribution_html, p.slug AS parent_slug, t.manuscript_url, t.description ' +
      'FROM texts t LEFT JOIN texts p ON p.id = t.parent_text_id',
    scopedWhere: 't.slug = ?',
    scopedArgCount: 1,
    keyCols: ['slug'],
    cols: [
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
      'parent_slug',
      'manuscript_url',
      'description',
    ],
  },
  {
    table: 'verses',
    sql:
      'SELECT t.slug AS text_slug, v.book, v.chapter, v.verse_num, v.devanagari, ' +
      'v.slp1, v.iast, v.meter, v.manuscript_folio_ref ' +
      'FROM verses v JOIN texts t ON t.id = v.text_id',
    scopedWhere: 't.slug = ?',
    scopedArgCount: 1,
    keyCols: ['text_slug', 'chapter', 'verse_num'],
    cols: [
      'text_slug',
      'book',
      'chapter',
      'verse_num',
      'devanagari',
      'slp1',
      'iast',
      'meter',
      'manuscript_folio_ref',
    ],
  },
  {
    table: 'translations',
    sql:
      'SELECT t.slug AS text_slug, v.chapter, v.verse_num, tr.lang, tr.translator, ' +
      'tr.translation_text, tr.source, tr.license, tr.status, tr.ai_assisted, tr.model, ' +
      'tr.model_version, tr.prompt_version, tr.judge_score, tr.reviewer, tr.reviewed_at ' +
      'FROM translations tr JOIN verses v ON v.id = tr.verse_id JOIN texts t ON t.id = v.text_id',
    scopedWhere: 't.slug = ?',
    scopedArgCount: 1,
    keyCols: ['text_slug', 'chapter', 'verse_num', 'lang', 'translator'],
    cols: [
      'text_slug',
      'chapter',
      'verse_num',
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
    ],
  },
  {
    table: 'word_glosses',
    sql:
      'SELECT t.slug AS text_slug, v.chapter, v.verse_num, w.word_idx, w.gloss_lang, ' +
      'w.word_sa, w.lemma_sa, w.lemma_iast, w.gloss_text, w.morph ' +
      'FROM word_glosses w JOIN verses v ON v.id = w.verse_id JOIN texts t ON t.id = v.text_id',
    scopedWhere: 't.slug = ?',
    scopedArgCount: 1,
    keyCols: ['text_slug', 'chapter', 'verse_num', 'word_idx', 'gloss_lang'],
    cols: [
      'text_slug',
      'chapter',
      'verse_num',
      'word_idx',
      'gloss_lang',
      'word_sa',
      'lemma_sa',
      'lemma_iast',
      'gloss_text',
      'morph',
    ],
  },
  {
    table: 'parallels',
    sql:
      'SELECT st.slug AS source_text_slug, sv.chapter AS source_chapter, ' +
      'sv.verse_num AS source_verse_num, tt.slug AS target_text_slug, ' +
      'tv.chapter AS target_chapter, tv.verse_num AS target_verse_num, ' +
      'p.citation_type, p.confidence, p.extracted_by ' +
      'FROM parallels p ' +
      'JOIN verses sv ON sv.id = p.source_verse_id JOIN texts st ON st.id = sv.text_id ' +
      'JOIN verses tv ON tv.id = p.target_verse_id JOIN texts tt ON tt.id = tv.text_id',
    scopedWhere: 'st.slug = ? OR tt.slug = ?',
    scopedArgCount: 2,
    keyCols: [
      'source_text_slug',
      'source_chapter',
      'source_verse_num',
      'target_text_slug',
      'target_chapter',
      'target_verse_num',
    ],
    cols: [
      'source_text_slug',
      'source_chapter',
      'source_verse_num',
      'target_text_slug',
      'target_chapter',
      'target_verse_num',
      'citation_type',
      'confidence',
      'extracted_by',
    ],
  },
];

/** Verification SELECT for a table; scoped by text slug when `scoped`. */
export function verifySql(spec: VerifySpec, scoped: boolean): string {
  return scoped ? `${spec.sql} WHERE ${spec.scopedWhere}` : spec.sql;
}

/**
 * Normalize a driver value to a JSON-stable form. bun:sqlite returns
 * number|string|bigint|null|Uint8Array; libSQL HTTP may return BigInt for
 * INTEGER columns. Both must hash identically.
 */
export function canonicalValue(v: unknown): string | number | boolean | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'bigint') {
    return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(v)
      : v.toString();
  }
  if (v instanceof Uint8Array) return `blob:${Buffer.from(v).toString('hex')}`;
  return v as string | number | boolean;
}

/** Canonical serialization of one row over `cols` (order significant). */
export function canonicalRow(row: Record<string, unknown>, cols: string[]): string {
  return JSON.stringify(cols.map((c) => canonicalValue(row[c])));
}

/**
 * Order-independent SHA-256 over the canonical rows. Sorting client-side
 * avoids depending on SQL ORDER BY / collation agreement between drivers.
 */
export function checksumRows(rows: Array<Record<string, unknown>>, cols: string[]): string {
  const canonical = rows.map((r) => canonicalRow(r, cols)).sort();
  const h = createHash('sha256');
  for (const line of canonical) h.update(line).update('\n');
  return h.digest('hex');
}

export interface RowSetDiff {
  onlyLocal: string[];
  onlyRemote: string[];
  changed: string[];
}

/** Key-level diff between local and remote row sets (for mismatch reporting). */
export function diffRowSets(
  localRows: Array<Record<string, unknown>>,
  remoteRows: Array<Record<string, unknown>>,
  spec: VerifySpec,
): RowSetDiff {
  const localByKey = new Map(localRows.map((r) => [canonicalRow(r, spec.keyCols), r]));
  const remoteByKey = new Map(remoteRows.map((r) => [canonicalRow(r, spec.keyCols), r]));
  const diff: RowSetDiff = { onlyLocal: [], onlyRemote: [], changed: [] };
  for (const [key, lr] of localByKey) {
    const rr = remoteByKey.get(key);
    if (!rr) diff.onlyLocal.push(key);
    else if (canonicalRow(lr, spec.cols) !== canonicalRow(rr, spec.cols)) diff.changed.push(key);
  }
  for (const key of remoteByKey.keys()) {
    if (!localByKey.has(key)) diff.onlyRemote.push(key);
  }
  return diff;
}

/** Human-readable diff summary, capped at `limit` keys per category. */
export function formatRowSetDiff(table: string, diff: RowSetDiff, limit = 10): string {
  const lines: string[] = [];
  const section = (label: string, keys: string[]) => {
    if (keys.length === 0) return;
    lines.push(`  ${label} (${keys.length}):`);
    for (const k of keys.slice(0, limit)) lines.push(`    ${k}`);
    if (keys.length > limit) lines.push(`    ... and ${keys.length - limit} more`);
  };
  lines.push(`[${table}] content mismatch:`);
  section('missing on remote', diff.onlyLocal);
  section('stale/extra on remote', diff.onlyRemote);
  section('content differs', diff.changed);
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Runtime helpers (network / local DB — not exercised by unit tests)
// ─────────────────────────────────────────────────────────────────────────────

function die(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
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

async function main(): Promise<void> {
  const TURSO_URL = process.env.TURSO_CORPUS_URL;
  const TURSO_TOKEN = process.env.TURSO_CORPUS_AUTH_TOKEN;
  const DB_PATH = resolve(process.env.SOHAMHAMSO_DB_PATH ?? 'db/sohamhamso.db');
  const BATCH_SIZE = Number(process.env.TURSO_SEED_BATCH_SIZE ?? '200');

  if (!TURSO_URL) die('TURSO_CORPUS_URL not set (source .env.production.local first).');
  if (!TURSO_TOKEN) die('TURSO_CORPUS_AUTH_TOKEN not set (source .env.production.local first).');
  if (!existsSync(DB_PATH)) {
    die(
      `Local SQLite not found at ${DB_PATH}. The corpus DB is not committed — build it from YAML first: \`bun run db:build\` (db:init + ingest), or point SOHAMHAMSO_DB_PATH at an existing DB.`,
    );
  }
  if (!Number.isInteger(BATCH_SIZE) || BATCH_SIZE < 1 || BATCH_SIZE > 500) {
    die(`TURSO_SEED_BATCH_SIZE must be an integer in [1, 500], got ${BATCH_SIZE}`);
  }

  let opts: CliOptions;
  try {
    opts = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    die((err as Error).message);
  }

  const redactedToken = `${TURSO_TOKEN.slice(0, 5)}...${TURSO_TOKEN.slice(-5)}`;
  const mode = opts.deleteOnly
    ? `delete-only (--text ${opts.textSlug})`
    : opts.textSlug
      ? `per-text${opts.replace ? ' + replace' : ''} (--text ${opts.textSlug})`
      : 'full-DB (legacy, empty target only)';
  console.log(`Source : ${DB_PATH}`);
  console.log(`Target : ${TURSO_URL}`);
  console.log(`Token  : ${redactedToken}`);
  console.log(`Batch  : ${BATCH_SIZE}`);
  console.log(`Mode   : ${mode}`);
  console.log('');

  const local = new Database(DB_PATH, { readonly: true });
  local.exec('PRAGMA query_only = ON;');
  const turso: Client = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });

  // ── Small query helpers bound to the two connections ──────────────────────

  function localRows(sql: string, args: string[] = []): Array<Record<string, unknown>> {
    return local.query<Record<string, unknown>, string[]>(sql).all(...args);
  }

  function localCount(spec: TableSpec, textId: string | null): number {
    const rows = localRows(countSql(spec, textId !== null), textId ? scopedArgs(spec, textId) : []);
    return Number(rows[0]?.n ?? 0);
  }

  async function tursoRows(
    sql: string,
    args: string[] = [],
  ): Promise<Array<Record<string, unknown>>> {
    const res = await turso.execute({ sql, args });
    return res.rows as unknown as Array<Record<string, unknown>>;
  }

  /** INTEGER results may come back as BigInt over HTTP — cast. */
  async function tursoCount(spec: TableSpec, textId: string | null): Promise<number> {
    const rows = await tursoRows(
      countSql(spec, textId !== null),
      textId ? scopedArgs(spec, textId) : [],
    );
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * Stream rows from the seed SELECT in chunks of BATCH_SIZE and push each
   * chunk as a single libSQL `batch()` call. Returns total rows attempted
   * and total rowsAffected reported by Turso (sum over all statements).
   */
  async function seedTable(
    spec: TableSpec,
    textId: string | null,
  ): Promise<{ attempted: number; affected: number }> {
    const rows = localRows(
      seedSelectSql(spec, textId !== null),
      textId ? scopedArgs(spec, textId) : [],
    );
    if (rows.length === 0) {
      console.log(`[${spec.table}] 0 rows (skip)`);
      return { attempted: 0, affected: 0 };
    }

    let attempted = 0;
    let affected = 0;
    const chunks = chunk(rows, BATCH_SIZE);
    for (const [i, part] of chunks.entries()) {
      const stmts = buildInserts(spec.table, spec.columns, part);
      const results = await turso.batch(stmts, 'write');
      for (const r of results) {
        affected += Number(r.rowsAffected ?? 0);
      }
      attempted += part.length;
      console.log(
        `  [${spec.table} ${i + 1}/${chunks.length}] +${part.length} (running ${attempted}/${rows.length}) ✓`,
      );
    }
    return { attempted, affected };
  }

  /**
   * Guard against explicit-id collisions: local AUTOINCREMENT ids for this
   * text must not already be taken on the remote by other texts' rows
   * (INSERT OR IGNORE would silently skip ours).
   */
  async function assertNoRemoteIdCollisions(spec: TableSpec, textId: string): Promise<void> {
    if (spec.table === 'texts') return; // covered by the per-text emptiness check
    const ids = localRows(
      `SELECT id FROM ${spec.table} WHERE ${spec.scopedWhere}`,
      scopedArgs(spec, textId),
    ).map((r) => String(r.id));
    for (const part of chunk(ids, BATCH_SIZE)) {
      const placeholders = part.map(() => '?').join(', ');
      const rows = await tursoRows(
        `SELECT count(*) AS n FROM ${spec.table} WHERE id IN (${placeholders})`,
        part,
      );
      if (Number(rows[0]?.n ?? 0) > 0) {
        die(
          `[${spec.table}] remote already holds rows with ids this seed would insert (local AUTOINCREMENT ids collide with other remote rows). Re-align ids or rebuild from a full backup before seeding "${textId}".`,
        );
      }
    }
  }

  /** Content verification for the seeded scope. Returns mismatch count. */
  async function verifyContent(textSlug: string | null): Promise<number> {
    console.log('\nVerification — comparing content checksums (natural keys + content columns):');
    let mismatches = 0;
    for (const spec of VERIFY_SPECS) {
      const scoped = textSlug !== null;
      const args = scoped ? Array(spec.scopedArgCount).fill(textSlug as string) : [];
      const lRows = localRows(verifySql(spec, scoped), args);
      const rRows = await tursoRows(verifySql(spec, scoped), args);
      const lSum = checksumRows(lRows, spec.cols);
      const rSum = checksumRows(rRows, spec.cols);
      if (lSum === rSum) {
        console.log(`  ✓ ${spec.table}: ${lRows.length} rows, checksum ${lSum.slice(0, 12)}…`);
      } else {
        mismatches += 1;
        console.log(
          `  ERROR ${spec.table}: local=${lSum.slice(0, 12)}… remote=${rSum.slice(0, 12)}…`,
        );
        console.error(formatRowSetDiff(spec.table, diffRowSets(lRows, rRows, spec)));
      }
    }
    return mismatches;
  }

  // ── Resolve --text scope ───────────────────────────────────────────────────

  let textId: string | null = null;
  if (opts.textSlug) {
    const row = localRows('SELECT id FROM texts WHERE slug = ?', [opts.textSlug])[0];
    if (!row && !opts.deleteOnly) {
      die(`No local text with slug "${opts.textSlug}" in ${DB_PATH}.`);
    }
    textId = row ? String(row.id) : null;
  }

  // ── Destructive phase (--replace / --delete-only) ──────────────────────────

  if (opts.replace || opts.deleteOnly) {
    // Resolve the text id on the REMOTE by slug — after a local rebuild the
    // remote rows may carry a different id, and those are the rows to remove.
    const remote = await tursoRows('SELECT id FROM texts WHERE slug = ?', [
      opts.textSlug as string,
    ]);
    const remoteTextId = remote[0] ? String(remote[0].id) : textId;
    if (!remoteTextId) {
      die(
        `No text with slug "${opts.textSlug}" found locally or on the remote — nothing to delete.`,
      );
    }
    console.log(`Deleting remote rows for text "${opts.textSlug}" (id ${remoteTextId})...`);
    const results = await turso.batch(buildDeleteStatements(remoteTextId), 'write');
    const ordered: SeedTable[] = ['parallels', 'word_glosses', 'translations', 'verses', 'texts'];
    ordered.forEach((table, i) => {
      console.log(`  [${table}] -${Number(results[i]?.rowsAffected ?? 0)}`);
    });

    if (opts.deleteOnly) {
      // Verify the scope is actually empty before declaring success.
      let leftover = 0;
      for (const spec of TABLE_SPECS) {
        leftover += await tursoCount(spec, remoteTextId);
      }
      if (leftover > 0) {
        console.error(`\n✗ ${leftover} remote row(s) still in scope after delete.`);
        process.exit(2);
      }
      console.log(`\n✓ remote rows for "${opts.textSlug}" removed. Done.`);
      process.exit(0);
    }
    console.log('');
  }

  // ── Pre-flight: target scope must be empty ─────────────────────────────────

  if (textId) {
    console.log(`Pre-flight: verifying Turso target is empty for text "${opts.textSlug}"...`);
    const nonEmpty: string[] = [];
    for (const spec of TABLE_SPECS) {
      const n = await tursoCount(spec, textId);
      console.log(`  ${spec.table}: ${n}`);
      if (n > 0) nonEmpty.push(spec.table);
    }
    if (nonEmpty.length > 0) {
      die(
        `Target DB already has rows for text "${opts.textSlug}" in: ${nonEmpty.join(', ')}. ` +
          `Re-seed with --replace --backup-confirmed (backup first via ${BACKUP_WORKFLOW}).`,
      );
    }
    for (const spec of TABLE_SPECS) {
      await assertNoRemoteIdCollisions(spec, textId);
    }
    console.log('  ✓ per-text scope empty, no remote id collisions\n');
  } else {
    console.log('Pre-flight: verifying Turso target is empty for seeded tables...');
    const nonEmpty: string[] = [];
    for (const spec of TABLE_SPECS) {
      const n = await tursoCount(spec, null);
      console.log(`  ${spec.table}: ${n}`);
      if (n > 0) nonEmpty.push(spec.table);
    }
    if (nonEmpty.length > 0) {
      die(
        `Target DB is not empty for: ${nonEmpty.join(', ')}. Full-DB mode only seeds empty targets — use --text <slug> to add one text, or --text <slug> --replace --backup-confirmed to re-seed one.`,
      );
    }
    console.log('  ✓ all seeded tables empty\n');
  }

  // ── Seed in FK-correct order ───────────────────────────────────────────────

  const t0 = Date.now();
  for (const spec of TABLE_SPECS) {
    await seedTable(spec, textId);
  }
  const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);

  // ── Verify ─────────────────────────────────────────────────────────────────

  const mismatches = await verifyContent(opts.textSlug);
  console.log(`\nElapsed: ${elapsedSec}s`);
  if (mismatches > 0) {
    console.error(
      `\n✗ ${mismatches} table(s) had content-checksum mismatch (see diffs above). Rollback: --text <slug> --replace --backup-confirmed from a last-good local DB, or --text <slug> --delete-only --backup-confirmed.`,
    );
    process.exit(2);
  }
  console.log('\n✓ all seeded tables match local source content. Done.');
  process.exit(0);
}

// Only execute main when invoked as a script (not when imported by tests).
const invokedDirectly =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  process.argv[1].endsWith('turso-seed-corpus.ts');

if (invokedDirectly) {
  await main();
}
