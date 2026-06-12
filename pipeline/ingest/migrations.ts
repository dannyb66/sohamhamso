#!/usr/bin/env bun
/**
 * sohamhamso — numbered SQL migration runner
 *
 * Applies pending migrations from `db/migrations/NNN_name.sql` (numeric
 * order) to (a) the local bun:sqlite DB and/or (b) Turso over libSQL HTTP
 * (same transport as scripts/turso-apply-schema-http.ts). Applied
 * migrations are tracked in a `schema_migrations` table, so re-running is
 * a no-op.
 *
 * `db/schema.sql` stays the canonical fresh-create: a DB initialized from
 * it already contains every migrated column/table. Each migration file may
 * therefore declare a guard comment:
 *
 *   -- guard: SELECT count(*) FROM pragma_table_info('verses') WHERE name = 'section_type'
 *
 * When the guard query returns a truthy value the migration's statements
 * are skipped but the migration is still stamped as applied — this lets
 * the runner converge fresh-from-schema.sql DBs and old DBs to the same
 * ledger without "duplicate column" failures.
 *
 * Run:
 *   bun pipeline/ingest/migrations.ts                       # local, db/sohamhamso.db
 *   bun pipeline/ingest/migrations.ts --db /tmp/test.db     # local, custom path
 *   bun pipeline/ingest/migrations.ts --turso               # Turso (env-gated:
 *       TURSO_CORPUS_URL + TURSO_CORPUS_AUTH_TOKEN, e.g. .env.production.local)
 */

import { Database } from 'bun:sqlite';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// pipeline/ingest/migrations.ts -> project root is two levels up
export const PROJECT_ROOT = resolve(__dirname, '..', '..');
export const DEFAULT_DB_PATH = join(PROJECT_ROOT, 'db', 'sohamhamso.db');
export const DEFAULT_MIGRATIONS_DIR = join(PROJECT_ROOT, 'db', 'migrations');

/** Matches `001_verses_prose_sections.sql` — three digits, underscore, name. */
const MIGRATION_FILE_RE = /^(\d{3})_[a-z0-9-]+(?:_[a-z0-9-]+)*\.sql$/;
const GUARD_RE = /^--\s*guard:\s*(.+?)\s*$/m;

export interface Migration {
  /** Filename without `.sql` — primary key in schema_migrations. */
  id: string;
  /** Absolute path to the source file. */
  file: string;
  /** Optional already-applied probe (SQL returning a truthy scalar). */
  guard: string | null;
  /** Executable statements, comments stripped. */
  statements: string[];
}

export interface ApplyResult {
  /** Migrations whose statements actually ran. */
  applied: string[];
  /** Guard said "already present" — stamped without executing. */
  skipped: string[];
  /** Already in schema_migrations — untouched. */
  alreadyApplied: string[];
}

/**
 * Split a migration file into executable statements. Same approach as
 * scripts/turso-apply-schema-http.ts: split on semicolon-followed-by-
 * newline, drop comment-only fragments.
 */
export function splitSqlStatements(sql: string): string[] {
  return sql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => {
      if (s.length === 0) return false;
      const nonCommentLines = s
        .split('\n')
        .filter((line) => !line.trim().startsWith('--') && line.trim().length > 0);
      return nonCommentLines.length > 0;
    });
}

export function loadMigrations(dir: string = DEFAULT_MIGRATIONS_DIR): Migration[] {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((f) => MIGRATION_FILE_RE.test(f))
    .sort();

  const seenNumbers = new Map<string, string>();
  const migrations: Migration[] = [];
  for (const file of files) {
    const num = file.slice(0, 3);
    const clash = seenNumbers.get(num);
    if (clash) {
      throw new Error(`duplicate migration number ${num}: ${clash} vs ${file}`);
    }
    seenNumbers.set(num, file);

    const raw = readFileSync(join(dir, file), 'utf8');
    const guardMatch = GUARD_RE.exec(raw);
    migrations.push({
      id: file.replace(/\.sql$/, ''),
      file: join(dir, file),
      guard: guardMatch ? guardMatch[1] : null,
      statements: splitSqlStatements(raw),
    });
  }
  return migrations;
}

export const SCHEMA_MIGRATIONS_DDL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

// ---------------------------------------------------------------
// Local (bun:sqlite)
// ---------------------------------------------------------------

export function applyMigrationsLocal(
  dbPath: string = DEFAULT_DB_PATH,
  migrations: Migration[] = loadMigrations(),
): ApplyResult {
  if (!existsSync(dbPath)) {
    throw new Error(`DB not found at ${dbPath}. Run \`bun pipeline/ingest/init-db.ts\` first.`);
  }

  const result: ApplyResult = { applied: [], skipped: [], alreadyApplied: [] };
  const db = new Database(dbPath);
  try {
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(SCHEMA_MIGRATIONS_DDL);

    const done = new Set(
      db
        .query<{ id: string }, []>('SELECT id FROM schema_migrations')
        .all()
        .map((r) => r.id),
    );
    const stamp = db.prepare('INSERT INTO schema_migrations (id) VALUES (?)');

    for (const m of migrations) {
      if (done.has(m.id)) {
        result.alreadyApplied.push(m.id);
        continue;
      }
      let guardHit = false;
      if (m.guard) {
        const probe = db.query(m.guard).get() as Record<string, unknown> | undefined;
        guardHit = Boolean(probe && Object.values(probe)[0]);
      }
      const tx = db.transaction(() => {
        if (!guardHit) {
          for (const stmt of m.statements) db.exec(stmt);
        }
        stamp.run(m.id);
      });
      tx();
      (guardHit ? result.skipped : result.applied).push(m.id);
    }
  } finally {
    db.close();
  }
  return result;
}

// ---------------------------------------------------------------
// Turso (libSQL HTTP — per-DB auth token, same as turso-apply-schema-http)
// ---------------------------------------------------------------

export async function applyMigrationsTurso(
  url: string,
  authToken: string,
  migrations: Migration[] = loadMigrations(),
): Promise<ApplyResult> {
  const { createClient } = await import('@libsql/client/web');
  const client = createClient({ url, authToken });
  const result: ApplyResult = { applied: [], skipped: [], alreadyApplied: [] };
  try {
    await client.execute(SCHEMA_MIGRATIONS_DDL);

    const doneRows = await client.execute('SELECT id FROM schema_migrations');
    const done = new Set(doneRows.rows.map((r) => String(r.id)));

    for (const m of migrations) {
      if (done.has(m.id)) {
        result.alreadyApplied.push(m.id);
        continue;
      }
      let guardHit = false;
      if (m.guard) {
        const probe = await client.execute(m.guard);
        const first = probe.rows[0];
        guardHit = Boolean(first && Object.values(first)[0]);
      }
      // batch() runs as a single transaction: statements + the ledger
      // insert commit together or roll back together.
      const stamp = {
        sql: 'INSERT INTO schema_migrations (id) VALUES (?)',
        args: [m.id],
      };
      await client.batch(guardHit ? [stamp] : [...m.statements, stamp], 'write');
      (guardHit ? result.skipped : result.applied).push(m.id);
    }
  } finally {
    client.close();
  }
  return result;
}

// ---------------------------------------------------------------
// CLI
// ---------------------------------------------------------------

export interface MigrateOptions {
  dbPath?: string;
  migrationsDir?: string;
  turso?: boolean;
}

export function parseArgs(argv: string[]): MigrateOptions {
  const opts: MigrateOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--db' && argv[i + 1]) opts.dbPath = argv[++i];
    else if (a === '--dir' && argv[i + 1]) opts.migrationsDir = argv[++i];
    else if (a === '--turso') opts.turso = true;
  }
  return opts;
}

function report(target: string, r: ApplyResult): void {
  console.log(
    `${target}: applied [${r.applied.join(', ') || '—'}]  ` +
      `guard-skipped [${r.skipped.join(', ') || '—'}]  ` +
      `already-applied [${r.alreadyApplied.join(', ') || '—'}]`,
  );
}

export async function main() {
  const opts = parseArgs(Bun.argv.slice(2));
  const migrations = loadMigrations(opts.migrationsDir ?? DEFAULT_MIGRATIONS_DIR);
  if (migrations.length === 0) {
    console.log('No migration files found.');
    return;
  }

  if (opts.turso) {
    const url = process.env.TURSO_CORPUS_URL;
    const token = process.env.TURSO_CORPUS_AUTH_TOKEN;
    if (!url || !token) {
      console.error(
        '--turso requires TURSO_CORPUS_URL and TURSO_CORPUS_AUTH_TOKEN ' +
          '(source .env.production.local first).',
      );
      process.exit(1);
    }
    report(url, await applyMigrationsTurso(url, token, migrations));
    // --turso targets Turso only unless --db is also given explicitly.
    if (!opts.dbPath) return;
  }

  const dbPath = opts.dbPath ?? DEFAULT_DB_PATH;
  report(dbPath, applyMigrationsLocal(dbPath, migrations));
}

// Bun: execute when run directly (not when imported by tests).
if (import.meta.main) {
  main();
}
