#!/usr/bin/env bun
/** Verify the static export against the local SQLite corpus without network access. */

import { Database } from 'bun:sqlite';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.env.SOHAMHAMSO_DB_PATH ?? join(root, 'db', 'sohamhamso.db');
const outDir = resolve(process.env.STATIC_CORPUS_OUT ?? join(root, 'dist', '_data', 'corpus'));
const manifestPath = join(outDir, 'manifest.json');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
  version: number;
  texts: Array<{ slug: string; chapters: number[] }>;
  search_languages: string[];
};
if (manifest.version !== 1)
  throw new Error(`Unsupported static corpus version: ${manifest.version}`);

const db = new Database(dbPath, { readonly: true });
const expected = db
  .query<{ texts: number; verses: number; translations: number; glosses: number }, []>(`
    SELECT
      (SELECT COUNT(*) FROM texts) AS texts,
      (SELECT COUNT(*) FROM verses) AS verses,
      (SELECT COUNT(*) FROM translations WHERE status IN ('published', 'reviewed')) AS translations,
      (SELECT COUNT(*) FROM word_glosses) AS glosses
  `)
  .get();
db.close();

const actual = { texts: manifest.texts.length, verses: 0, translations: 0, glosses: 0 };
let largestBytes = 0;
for (const text of manifest.texts) {
  for (const chapter of text.chapters) {
    const path = join(outDir, text.slug, `${chapter}.json`);
    const stat = statSync(path);
    largestBytes = Math.max(largestBytes, stat.size);
    const bundle = JSON.parse(readFileSync(path, 'utf8')) as {
      verses: unknown[];
      translations: unknown[];
      glosses: unknown[];
    };
    actual.verses += bundle.verses.length;
    actual.translations += bundle.translations.length;
    actual.glosses += bundle.glosses.length;
  }
}

for (const lang of manifest.search_languages) {
  const path = join(outDir, 'search', `${lang}.json`);
  const stat = statSync(path);
  largestBytes = Math.max(largestBytes, stat.size);
  const shard = JSON.parse(readFileSync(path, 'utf8')) as { rows: unknown[] };
  if (shard.rows.length === 0) {
    throw new Error(`Search shard is empty for ${lang}`);
  }
}

if (!expected || JSON.stringify(actual) !== JSON.stringify(expected)) {
  throw new Error(
    `Static corpus mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

const corpusFiles = filesUnder(outDir);
for (const path of corpusFiles) {
  const bytes = statSync(path).size;
  largestBytes = Math.max(largestBytes, bytes);
  if (bytes > 25 * 1024 * 1024) throw new Error(`Corpus asset exceeds Pages asset limit: ${path}`);
}
for (const name of ['lemmas.json', 'lemma-summaries.json']) {
  const data = JSON.parse(readFileSync(join(outDir, name), 'utf8'));
  if (data.version !== 1 || !Array.isArray(data.rows) || data.rows.length === 0) {
    throw new Error(`Static lemma asset is empty or invalid: ${name}`);
  }
}

const workerDirectory = join(root, 'dist', '_worker.js');
if (outDir === join(root, 'dist', '_data', 'corpus') && existsSync(workerDirectory)) {
  for (const path of filesUnder(workerDirectory).filter((file) => /\.[cm]?js$/.test(file))) {
    const source = readFileSync(path, 'utf8');
    if (/TURSO_(?:CORPUS|PII)_(?:URL|AUTH_TOKEN)|@libsql\/client|getLibsqlClient/.test(source)) {
      throw new Error(`Turso code must not ship in the website Worker: ${path}`);
    }
  }
  const routes = JSON.parse(readFileSync(join(root, 'dist', '_routes.json'), 'utf8'));
  if ((routes.include?.length ?? 0) + (routes.exclude?.length ?? 0) > 100) {
    throw new Error('Cloudflare Pages routing exceeds its combined 100-rule limit.');
  }
  if (!routes.exclude?.includes('/_data/*')) {
    throw new Error('Generated corpus assets must be excluded from Worker routing.');
  }
}

console.log(
  JSON.stringify({ ok: true, files: corpusFiles.length, largest_bytes: largestBytes, ...actual }),
);
