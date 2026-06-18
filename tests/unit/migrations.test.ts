// biome-ignore lint/correctness/noUndeclaredDependencies: bun built-in
import { Database } from 'bun:sqlite';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
/**
 * Unit tests for `pipeline/ingest/migrations.ts`.
 *
 * Contract under test:
 *   - db/schema.sql stays the canonical fresh-create;
 *   - applying db/migrations/*.sql to a pre-migration DB converges the
 *     verses table to the same column definitions as schema.sql;
 *   - the runner is idempotent (schema_migrations ledger) and guard-stamps
 *     schema.sql-fresh DBs instead of failing on duplicate columns.
 *
 * Run with: `bun --bun vitest run tests/unit/migrations.test.ts`
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_MIGRATIONS_DIR,
  applyMigrationsLocal,
  loadMigrations,
  splitSqlStatements,
} from '../../pipeline/ingest/migrations';

const SCHEMA_PATH = resolve(__dirname, '..', '..', 'db', 'schema.sql');

/**
 * Pre-migration baseline: the verses table (and its texts FK target) as it
 * existed before migration 001 added section_type/prose_block_ref. This is
 * what migration 001 is written against.
 */
const OLD_BASELINE_SQL = `
CREATE TABLE texts (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title_sa TEXT NOT NULL,
  title_en TEXT NOT NULL,
  tradition TEXT NOT NULL,
  license TEXT NOT NULL
);
CREATE TABLE verses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text_id TEXT NOT NULL REFERENCES texts(id),
  book INTEGER,
  chapter INTEGER NOT NULL,
  verse_num INTEGER NOT NULL,
  devanagari TEXT NOT NULL,
  slp1 TEXT,
  iast TEXT,
  meter TEXT,
  manuscript_folio_ref TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (text_id, chapter, verse_num)
);
`;

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
}

function newColumns(path: string): ColumnInfo[] {
  const db = new Database(path, { readonly: true });
  try {
    return db
      .query<ColumnInfo, []>(
        'SELECT name, type, "notnull", dflt_value FROM pragma_table_info(\'verses\') ' +
          "WHERE name IN ('section_type','prose_block_ref') ORDER BY name",
      )
      .all();
  } finally {
    db.close();
  }
}

function insertVerse(db: Database, sectionType: string | null): void {
  db.exec(
    "INSERT OR IGNORE INTO texts (id, slug, title_sa, title_en, tradition, license) VALUES ('t', 't', 's', 'e', 'trika', 'PD')",
  );
  if (sectionType === null) {
    db.exec(
      "INSERT INTO verses (text_id, chapter, verse_num, devanagari) VALUES ('t', 1, (SELECT COALESCE(MAX(verse_num),0)+1 FROM verses), 'd')",
    );
  } else {
    db.prepare(
      "INSERT INTO verses (text_id, chapter, verse_num, devanagari, section_type) VALUES ('t', 1, (SELECT COALESCE(MAX(verse_num),0)+1 FROM verses), 'd', ?)",
    ).run(sectionType);
  }
}

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'sohamhamso-migrations-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('loadMigrations()', () => {
  it('loads the committed migrations in numeric order with guards parsed', () => {
    const migrations = loadMigrations(DEFAULT_MIGRATIONS_DIR);
    expect(migrations.length).toBeGreaterThanOrEqual(1);
    expect(migrations.map((m) => m.id)).toEqual([...migrations.map((m) => m.id)].sort());

    const m001 = migrations[0]!;
    expect(m001.id).toBe('001_verses_prose_sections');
    expect(m001.guard).toContain("pragma_table_info('verses')");
    expect(m001.statements).toHaveLength(2);
    expect(m001.statements[0]).toMatch(/ALTER TABLE verses ADD COLUMN section_type/);
    expect(m001.statements[1]).toMatch(/ALTER TABLE verses ADD COLUMN prose_block_ref/);
  });

  it('throws on duplicate migration numbers', () => {
    const dir = join(tmp, 'migrations');
    mkdirSync(dir);
    writeFileSync(join(dir, '001_a.sql'), 'SELECT 1;\n', 'utf8');
    writeFileSync(join(dir, '001_b.sql'), 'SELECT 1;\n', 'utf8');
    expect(() => loadMigrations(dir)).toThrow(/duplicate migration number 001/);
  });

  it('splitSqlStatements drops comment-only fragments', () => {
    expect(splitSqlStatements('-- only a comment;\n\nSELECT 1;\n\n-- trailing comment;\n')).toEqual(
      ['SELECT 1'],
    );
  });
});

describe('applyMigrationsLocal() — old DB upgrade path', () => {
  it('brings a pre-migration DB to the same new-column definitions as schema.sql', () => {
    // Old DB: baseline schema, then migrations.
    const oldPath = join(tmp, 'old.db');
    const oldDb = new Database(oldPath);
    oldDb.exec(OLD_BASELINE_SQL);
    insertVerse(oldDb, null); // pre-existing row, must pick up the default
    oldDb.close();

    const result = applyMigrationsLocal(oldPath);
    expect(result.applied).toContain('001_verses_prose_sections');
    expect(result.skipped).toEqual([]);

    // Fresh DB: canonical schema.sql.
    const freshPath = join(tmp, 'fresh.db');
    const freshDb = new Database(freshPath);
    freshDb.exec(readFileSync(SCHEMA_PATH, 'utf8'));
    freshDb.close();

    // Column parity: name/type/notnull/default identical.
    expect(newColumns(oldPath)).toEqual(newColumns(freshPath));
    expect(newColumns(oldPath)).toEqual([
      { name: 'prose_block_ref', type: 'TEXT', notnull: 0, dflt_value: null },
      { name: 'section_type', type: 'TEXT', notnull: 1, dflt_value: "'verse'" },
    ]);

    // Pre-existing row picked up the default.
    const db = new Database(oldPath, { readonly: true });
    const row = db
      .query<{ section_type: string; prose_block_ref: string | null }, []>(
        'SELECT section_type, prose_block_ref FROM verses',
      )
      .get();
    db.close();
    expect(row).toEqual({ section_type: 'verse', prose_block_ref: null });

    // CHECK-constraint parity: both DBs accept 'prose' and reject junk.
    for (const path of [oldPath, freshPath]) {
      const d = new Database(path);
      d.exec('PRAGMA foreign_keys = ON;');
      insertVerse(d, 'prose');
      expect(() => insertVerse(d, 'stanza')).toThrow(/CHECK constraint failed/);
      d.close();
    }
  });

  it('is idempotent — a second run applies nothing and keeps one ledger row per migration', () => {
    const path = join(tmp, 'old.db');
    const db = new Database(path);
    db.exec(OLD_BASELINE_SQL);
    db.close();

    const first = applyMigrationsLocal(path);
    expect(first.applied.length).toBeGreaterThanOrEqual(1);

    const second = applyMigrationsLocal(path);
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual([]);
    expect(second.alreadyApplied).toEqual(first.applied);

    const check = new Database(path, { readonly: true });
    const n = check.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM schema_migrations').get();
    check.close();
    expect(n?.n).toBe(first.applied.length);
  });

  it('guard-stamps a schema.sql-fresh DB instead of failing on duplicate columns', () => {
    const path = join(tmp, 'fresh.db');
    const db = new Database(path);
    db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
    db.close();

    const result = applyMigrationsLocal(path);
    expect(result.applied).toEqual([]);
    expect(result.skipped).toContain('001_verses_prose_sections');

    // Stamped: a re-run sees it as already applied.
    const rerun = applyMigrationsLocal(path);
    expect(rerun.alreadyApplied).toContain('001_verses_prose_sections');
  });

  it('throws when the DB file does not exist', () => {
    expect(() => applyMigrationsLocal(join(tmp, 'missing.db'))).toThrow(/DB not found/);
  });

  it('rolls the migration back (no ledger row) when a statement fails', () => {
    const path = join(tmp, 'old.db');
    const db = new Database(path);
    db.exec(OLD_BASELINE_SQL);
    db.close();

    const dir = join(tmp, 'migrations');
    mkdirSync(dir);
    writeFileSync(
      join(dir, '001_boom.sql'),
      'ALTER TABLE verses ADD COLUMN ok_col TEXT;\nALTER TABLE no_such_table ADD COLUMN x TEXT;\n',
      'utf8',
    );

    expect(() => applyMigrationsLocal(path, loadMigrations(dir))).toThrow(/no such table/);

    const check = new Database(path, { readonly: true });
    const ledger = check
      .query<{ n: number }, []>('SELECT COUNT(*) AS n FROM schema_migrations')
      .get();
    const cols = check
      .query<{ n: number }, []>(
        "SELECT COUNT(*) AS n FROM pragma_table_info('verses') WHERE name = 'ok_col'",
      )
      .get();
    check.close();
    expect(ledger?.n).toBe(0);
    expect(cols?.n).toBe(0);
  });
});
