# Embedding pipeline

OpenAI `text-embedding-3-large` (3072 dims) over the verse corpus, powering
cross-text semantic search and the daily-verse theme rotation.

This directory is the **build-time** half of the search stack. The runtime
helpers live in [`src/lib/search.ts`](../../src/lib/search.ts).

---

## Quickstart

```bash
# 1. install deps (first time only)
bun add openai lru-cache

# 2. set the API key
export OPENAI_API_KEY=sk-...

# 3. dry-run to see what would be embedded + estimated cost
bun pipeline/embed/runner.ts --dry-run

# 4. real run — full corpus
bun pipeline/embed/runner.ts

# scoped re-runs (idempotent — already-embedded rows are skipped)
bun pipeline/embed/runner.ts --text siva-sutras --lang en
bun pipeline/embed/runner.ts --limit 100   # smoke test
```

---

## Env

| Var | Required | Notes |
|---|---|---|
| `OPENAI_API_KEY` | yes (skipped with warning if missing) | OpenAI org with `text-embedding-3-large` access |

Without an API key:
- the embed runner exits 0 with a warning (CI still passes),
- `semanticSearch()` returns `[]`,
- `blendedSearch()` degrades to lexical-only.

---

## Cost

`text-embedding-3-large` = **$0.13 per 1M tokens** (as of plan date).

Per the plan (`check-online-websites-aim-sparkling-pearl.md`):

```
25,000 verses × 50 tokens × 11 langs ≈ 14M tokens ≈ $1.80 full corpus
```

Phase 1 (Śiva Sūtras only, 77 sūtras × 11 langs × ~50 tokens) ≈ 42k tokens ≈ **$0.005**.
Dry-run prints a per-run estimate from the pending count before any API call.

---

## How it works

For every `(verse_id, lang)` pair that has a `translations` row but no
`verse_embeddings` row for the current model, the runner:

1. Builds the embed input as `<translation_text>\n\n<iast>` so semantic
   queries hit on both English-side concepts ("recognition", "stillness")
   and Sanskrit-side concepts (`spanda`, `pratyabhijñā`) without needing
   separate indexes.
2. Batches up to 100 inputs per OpenAI request.
3. Stores each 3072-dim Float32 vector as a little-endian BLOB in
   `verse_embeddings(verse_id, lang, embedding, model)`.
4. Wraps each batch in a SQLite transaction (one fsync per ~100 rows).

The BLOB layout matches **libSQL `F32_BLOB(3072)`** byte-for-byte, so the
production migration is `INSERT … SELECT` with no re-encoding.

---

## Blended search & RRF

`blendedSearch()` runs `lexicalSearch()` and `semanticSearch()` in parallel
(`Promise.all`) and fuses results with **Reciprocal Rank Fusion** (Cormack
et al., 2009):

```
score(doc) = Σ  1 / (k + rank_i(doc))     k = 60
            i ∈ {lexical, semantic}
```

Why RRF (vs. weighted sum of raw scores):
- BM25 scores and cosine similarities live on different scales — weighted
  sum requires hand-tuned normalisation per corpus.
- RRF only uses **ranks**, so it's invariant to scale / scoring choice.
- k=60 is the empirically-tuned default that's robust across IR benchmarks.

Tie-breaking is insertion-order (stable sort), favouring lexical hits on
exact-string matches. The fused result objects carry `source: 'blended'`.

---

## Query embedding cache

Production: Cloudflare KV, 1000 entries, 7-day TTL, key = `embed:${sha256(query)}`.
Drops the embed round-trip (~500ms p95) on cache hits.

Local dev: `lru-cache` in-memory with identical size + TTL. Behaviour is
identical to KV from the helper's perspective — same `get(norm)` / `set(norm, vec)`
calls, just a different backing store.

---

## Migrating to a separate vectors DB (production)

The local dev DB (`db/sohamhamso.db`) holds **all** logical tables in one
SQLite file. Production splits into three Turso DBs (corpus / vectors / pii).

Migration recipe for the vectors split:

1. Create the libSQL vectors DB with the production schema:
   ```sql
   CREATE TABLE verse_embeddings (
     id INTEGER PRIMARY KEY,
     verse_id INTEGER NOT NULL,   -- cross-DB FK, application-enforced
     lang TEXT NOT NULL,
     embedding F32_BLOB(3072) NOT NULL,
     model TEXT DEFAULT 'text-embedding-3-large',
     created_at TEXT DEFAULT (datetime('now')),
     UNIQUE (verse_id, lang, model)
   );
   CREATE INDEX idx_emb_vec ON verse_embeddings(libsql_vector_idx(embedding));
   ```
2. Stream rows from local SQLite → Turso. The BLOB bytes copy verbatim:
   ```bash
   sqlite3 db/sohamhamso.db \
     "SELECT verse_id, lang, hex(embedding), model FROM verse_embeddings" \
     | turso db shell sohamhamso-vectors < migrate.sql
   ```
3. Replace the full-scan loop in `semanticSearch()` with libSQL
   `vector_top_k('idx_emb_vec', :query_vec, :k)` — same return shape,
   <50ms p95.
4. Point search helpers at the vectors DB connection (separate libSQL
   client; `verse_id` joins the corpus DB at the application layer).
