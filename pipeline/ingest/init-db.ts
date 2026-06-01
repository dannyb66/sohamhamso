#!/usr/bin/env bun
/**
 * sohamhamso — DB initializer
 *
 * Creates `db/sohamhamso.db` from `db/schema.sql` if it does not exist.
 * With `--force`, drops + recreates the file.
 *
 * Run:
 *   bun pipeline/ingest/init-db.ts
 *   bun pipeline/ingest/init-db.ts --force
 *   bun pipeline/ingest/init-db.ts --db /tmp/test.db --schema db/schema.sql
 */

import { Database } from 'bun:sqlite';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// pipeline/ingest/init-db.ts -> project root is two levels up
export const PROJECT_ROOT = resolve(__dirname, '..', '..');
export const DEFAULT_DB_PATH = join(PROJECT_ROOT, 'db', 'sohamhamso.db');
export const DEFAULT_SCHEMA_PATH = join(PROJECT_ROOT, 'db', 'schema.sql');

export interface InitOptions {
  dbPath?: string;
  schemaPath?: string;
  force?: boolean;
}

export function initDb(opts: InitOptions = {}): {
  tables: string[];
  dbPath: string;
  created: boolean;
} {
  const dbPath = opts.dbPath ?? DEFAULT_DB_PATH;
  const schemaPath = opts.schemaPath ?? DEFAULT_SCHEMA_PATH;

  if (!existsSync(schemaPath)) {
    throw new Error(`Schema file not found: ${schemaPath}`);
  }

  const existed = existsSync(dbPath);

  if (existed && opts.force) {
    unlinkSync(dbPath);
    console.log(`Removed existing DB: ${dbPath}`);
  } else if (existed && !opts.force) {
    // Still apply the schema (CREATE TABLE IF NOT EXISTS is idempotent),
    // so newly added tables show up on re-init without --force.
    console.log(`DB exists at ${dbPath} (idempotent schema apply; use --force to recreate).`);
  }

  const schemaSql = readFileSync(schemaPath, 'utf8');
  const db = new Database(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(schemaSql);

  const tables = db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((r) => r.name);

  db.close();

  return { tables, dbPath, created: !existed || !!opts.force };
}

export function parseArgs(argv: string[]): InitOptions {
  const opts: InitOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') opts.force = true;
    else if (a === '--db' && argv[i + 1]) opts.dbPath = argv[++i];
    else if (a === '--schema' && argv[i + 1]) opts.schemaPath = argv[++i];
  }
  return opts;
}

export async function main() {
  const opts = parseArgs(Bun.argv.slice(2));
  const { tables, dbPath, created } = initDb(opts);
  console.log(
    `${created ? 'Created' : 'Verified'} DB at ${dbPath}\nTables (${tables.length}): ${tables.join(', ')}`,
  );
}

if (import.meta.main) {
  main();
}
