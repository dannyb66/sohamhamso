#!/usr/bin/env bun
/**
 * turso-apply-schema-http.ts — HTTP-mode schema applier.
 *
 * Counterpart to scripts/turso-apply-schema.sh. The .sh version uses the
 * `turso` CLI's account-level auth session; this version uses libSQL HTTP
 * with a per-DB auth token (the same kind that goes into CF Pages secrets
 * at deploy time). Use this when CLI login isn't available — e.g., browser
 * callback to localhost can't reach you on this machine.
 *
 * Usage:
 *   bun scripts/turso-apply-schema-http.ts <url> <auth_token> [schema-file]
 *
 * Example:
 *   bun scripts/turso-apply-schema-http.ts \
 *     "libsql://sohamhamso-corpus-sohamhamso.aws-ap-south-1.turso.io" \
 *     "$TURSO_CORPUS_AUTH_TOKEN"
 *
 * Schema file defaults to db/schema.sql relative to the repo root.
 *
 * Idempotency: schema.sql uses CREATE TABLE IF NOT EXISTS + CREATE INDEX IF
 * NOT EXISTS throughout, so re-running this against a populated DB is a
 * no-op.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@libsql/client/web';

const [, , urlArg, tokenArg, schemaArg] = process.argv;

if (!urlArg || !tokenArg) {
  console.error('Usage: bun scripts/turso-apply-schema-http.ts <url> <auth_token> [schema-file]');
  process.exit(1);
}

const schemaPath = resolve(schemaArg ?? 'db/schema.sql');
const schemaSQL = readFileSync(schemaPath, 'utf8');

// Split on semicolon-followed-by-newline. Strip comment-only fragments.
const statements = schemaSQL
  .split(/;\s*\n/)
  .map((s) => s.trim())
  .filter((s) => {
    if (s.length === 0) return false;
    // Drop fragments that are entirely SQL comments (-- ... lines)
    const nonCommentLines = s
      .split('\n')
      .filter((line) => !line.trim().startsWith('--') && line.trim().length > 0);
    return nonCommentLines.length > 0;
  });

console.log(`Applying ${statements.length} statements from ${schemaPath}`);
console.log(`Target: ${urlArg}`);

const client = createClient({ url: urlArg, authToken: tokenArg });

let ok = 0;
let fail = 0;
for (const stmt of statements) {
  try {
    await client.execute(stmt);
    ok += 1;
  } catch (err) {
    fail += 1;
    const first = stmt.split('\n').find((l) => l.trim().length > 0) ?? stmt.slice(0, 80);
    console.error(`✗ ${first.trim().slice(0, 80)}…`);
    console.error(`    ${(err as Error).message}`);
  }
}

const tables = await client.execute(
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
);
const indexes = await client.execute(
  "SELECT count(*) AS n FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'",
);

console.log(`\n✓ ${ok} ok / ✗ ${fail} fail`);
console.log(`Tables (${tables.rows.length}): ${tables.rows.map((r) => r.name).join(', ')}`);
console.log(`Indexes (excluding sqlite internal): ${indexes.rows[0]?.n}`);

process.exit(fail > 0 ? 2 : 0);
