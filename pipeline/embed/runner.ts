/**
 * pipeline/embed/runner.ts
 *
 * Embedding pipeline for sohamhamso verse corpus.
 *
 * Reads verses + translations from local SQLite (`db/sohamhamso.db`),
 * batch-embeds new (verse, lang) pairs via OpenAI `text-embedding-3-large`
 * (3072 dims), and stores Float32 BLOBs in `verse_embeddings`.
 *
 * Production architecture (per plan check-online-websites-aim-sparkling-pearl.md):
 *   - 3 Turso DBs: corpus + vectors + pii
 *   - vectors DB uses libSQL F32_BLOB(3072) + vector_top_k() index
 *   - this single-file SQLite is the dev mirror; the schema is identical
 *
 * Cost model (text-embedding-3-large @ $0.13 / 1M tokens):
 *   25,000 verses × 50 tokens × 11 langs ≈ 14M tokens ≈ $1.80 full corpus.
 *
 * CLI:
 *   bun pipeline/embed/runner.ts [--lang en] [--text siva-sutras] [--limit N] [--dry-run]
 *
 * Behaviour:
 *   - For each (verse, lang) we embed: `<translation_text>\n\n<iast>`
 *     so semantic search hits work across English queries AND
 *     Sanskrit-concept queries (iast is the searchable Sanskrit form).
 *   - Idempotent: skips (verse_id, lang, model) rows already present.
 *   - Batches up to 100 inputs per OpenAI request (API limit-safe).
 *
 * Env:
 *   OPENAI_API_KEY  — required (script exits with warning if missing)
 */

// biome-ignore lint/correctness/noUndeclaredDependencies: bun built-in
import { Database } from "bun:sqlite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// `openai` npm package — add via `bun add openai`.
// SDK v4: `new OpenAI({ apiKey }).embeddings.create({ model, input })`.
import OpenAI from "openai";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MODEL = "text-embedding-3-large";
const DIMS = 3072;
const BATCH_SIZE = 100; // OpenAI accepts up to 2048; we stay well under for safety
const HERE = dirname(fileURLToPath(import.meta.url));
// pipeline/embed/runner.ts → ../../db/sohamhamso.db
const DB_PATH = resolve(HERE, "..", "..", "db", "sohamhamso.db");

// ─────────────────────────────────────────────────────────────────────────────
// CLI parsing (minimal — no external dep)
// ─────────────────────────────────────────────────────────────────────────────

interface CliArgs {
  lang?: string;
  text?: string;
  limit?: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--lang") out.lang = argv[++i];
    else if (a === "--text") out.text = argv[++i];
    else if (a === "--limit") out.limit = Number(argv[++i]);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface PendingRow {
  verse_id: number;
  lang: string;
  translation_text: string;
  iast: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// DB helpers
// ─────────────────────────────────────────────────────────────────────────────

function openDb(): Database {
  const db = new Database(DB_PATH);
  // WAL mode for concurrent reads while we write embeddings.
  db.exec("PRAGMA journal_mode = WAL;");
  return db;
}

/**
 * Find (verse_id, lang) pairs that have a `translations` row but no
 * `verse_embeddings` row for the current MODEL. Optionally filtered.
 */
function findPending(
  db: Database,
  filter: { lang?: string; text?: string; limit?: number },
): PendingRow[] {
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (filter.lang) {
    clauses.push("t.lang = ?");
    params.push(filter.lang);
  }
  if (filter.text) {
    clauses.push("v.text_id = (SELECT id FROM texts WHERE slug = ?)");
    params.push(filter.text);
  }

  const where = clauses.length ? `AND ${clauses.join(" AND ")}` : "";
  const limit = filter.limit ? `LIMIT ${Number(filter.limit) | 0}` : "";

  const sql = `
    SELECT
      v.id              AS verse_id,
      t.lang            AS lang,
      t.translation_text AS translation_text,
      v.iast            AS iast
    FROM translations t
    JOIN verses v ON v.id = t.verse_id
    WHERE NOT EXISTS (
      SELECT 1 FROM verse_embeddings e
      WHERE e.verse_id = v.id
        AND e.lang     = t.lang
        AND e.model    = ?
    )
    ${where}
    ORDER BY v.text_id, v.chapter, v.verse_num, t.lang
    ${limit}
  `;

  const stmt = db.query<PendingRow, (string | number)[]>(sql);
  return stmt.all(MODEL, ...params);
}

/**
 * Encode Float32 vector → Buffer for SQLite BLOB.
 * libSQL F32_BLOB uses the same little-endian Float32 layout, so this
 * blob is forward-compatible with the production vectors DB.
 */
function float32ToBuffer(arr: number[]): Buffer {
  const f32 = new Float32Array(arr);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

/**
 * Compose the text we actually embed. Translation carries the semantic
 * payload in the target language; appending IAST lets queries like
 * "spanda" or "pratyabhijñā" hit even when the translation paraphrased.
 */
function buildInput(row: PendingRow): string {
  const iast = row.iast?.trim() ?? "";
  const t = row.translation_text.trim();
  return iast ? `${t}\n\n${iast}` : t;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    console.warn(
      "[embed] OPENAI_API_KEY not set — skipping embedding run. " +
        "Set the env var to enable. (dev fallback: lexical-only search still works.)",
    );
    process.exit(0);
  }

  const db = openDb();
  const pending = findPending(db, args);

  console.log(
    `[embed] model=${MODEL} dims=${DIMS} batch=${BATCH_SIZE} ` +
      `lang=${args.lang ?? "*"} text=${args.text ?? "*"} ` +
      `limit=${args.limit ?? "∞"} dryRun=${args.dryRun}`,
  );
  console.log(`[embed] ${pending.length} pending (verse, lang) pairs`);

  if (pending.length === 0) {
    console.log("[embed] nothing to do — corpus is fully embedded.");
    return;
  }

  if (args.dryRun) {
    const estTokens = pending.length * 50; // ~50 tokens per translation+iast (estimate)
    const estCost = (estTokens / 1_000_000) * 0.13;
    console.log(
      `[embed] DRY RUN — would embed ${pending.length} rows ` +
        `(~${estTokens.toLocaleString()} tokens, ~$${estCost.toFixed(4)}).`,
    );
    return;
  }

  const openai = new OpenAI({ apiKey });

  // Cache prepared insert; bind per row inside the txn loop.
  const insertStmt = db.query(`
    INSERT INTO verse_embeddings (verse_id, lang, embedding, model)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (verse_id, lang, model) DO NOTHING
  `);

  let done = 0;
  let totalTokens = 0;
  const start = Date.now();

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    const inputs = batch.map(buildInput);

    let resp: Awaited<ReturnType<typeof openai.embeddings.create>>;
    try {
      resp = await openai.embeddings.create({
        model: MODEL,
        input: inputs,
      });
    } catch (err) {
      console.error(
        `[embed] batch ${i / BATCH_SIZE} failed:`,
        err instanceof Error ? err.message : err,
      );
      // Fail loud — partial corpora are worse than no corpora here.
      throw err;
    }

    if (resp.data.length !== batch.length) {
      throw new Error(
        `[embed] batch length mismatch: got ${resp.data.length}, expected ${batch.length}`,
      );
    }

    // Single transaction per batch — keeps fsync count low.
    const writeTxn = db.transaction((rows: PendingRow[], vecs: number[][]) => {
      for (let j = 0; j < rows.length; j++) {
        const row = rows[j];
        const vec = vecs[j];
        if (vec.length !== DIMS) {
          throw new Error(
            `[embed] dim mismatch for verse_id=${row.verse_id} lang=${row.lang}: ` +
              `got ${vec.length}, expected ${DIMS}`,
          );
        }
        insertStmt.run(row.verse_id, row.lang, float32ToBuffer(vec), MODEL);
      }
    });
    writeTxn(
      batch,
      resp.data.map((d) => d.embedding as number[]),
    );

    done += batch.length;
    totalTokens += resp.usage?.total_tokens ?? 0;

    if (done % 500 === 0 || done === pending.length) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(
        `[embed] ${done}/${pending.length} (${elapsed}s, ${totalTokens.toLocaleString()} tokens)`,
      );
    }
  }

  const cost = (totalTokens / 1_000_000) * 0.13;
  console.log(
    `[embed] done — ${done} rows, ${totalTokens.toLocaleString()} tokens, $${cost.toFixed(4)}`,
  );
}

main().catch((err) => {
  console.error("[embed] fatal:", err);
  process.exit(1);
});
