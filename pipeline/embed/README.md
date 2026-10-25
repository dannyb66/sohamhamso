# Embedding pipeline

Optional local batch embedding and semantic retrieval experiments. [AI systems and evaluation](../../docs/AI-SYSTEMS-AND-EVALUATION.md#embeddings-and-retrieval) explains eligibility and invalidation limits. Local helpers are in [search.ts](../../src/lib/search.ts). Public website search uses generated lexical indexes only; semantic/blended API requests explicitly fall back to lexical results. This pipeline does not publish a website vector index.

## Safe inventory

Install the project's existing dependencies and build the local database; do not add SDKs separately:

```bash
bun install
bun run db:build
OPENAI_API_KEY=offline-dry-run-placeholder bun pipeline/embed/runner.ts --text siva-sutras --lang en --limit 1 --dry-run
```

The CLI checks for `OPENAI_API_KEY` before its dry-run branch; a non-secret placeholder permits inventory without provider calls. **Keep `--dry-run` in this example.** Without any key the runner exits 0 with a warning and does not inventory pending rows. The runner uses `db/sohamhamso.db`; it has no `--db` option.

A live run requires a real `OPENAI_API_KEY`, omits `--dry-run`, incurs API costs and inserts local vectors. The printed estimate uses hardcoded planning constants ($0.13/million tokens; 50 tokens/row), not current pricing or measured token use.

## Implemented flow

[runner.ts](runner.ts) selects translation/unit pairs lacking a vector for `text-embedding-3-large`, embeds `translation_text` plus IAST in batches of up to 100, and stores 3,072-dimensional Float32 BLOBs under `(verse_id, lang, model)`. Batch inserts are transactional and existing keys are skipped.

The pending selector does not filter `status`; it can embed drafts. Multiple translator rows can contend for one vector key, and changed translation content does not invalidate a vector automatically. Review those limits before using a generated index as publication evidence.

The local search helpers probe for `verses_fts` and otherwise use LIKE; semantic retrieval embeds a query and scans vectors by cosine similarity. Blended retrieval uses reciprocal rank fusion (`k=60`) and falls back to lexical results if semantic results are unavailable. Explicit semantic retrieval returns an empty list without a key/vectors. Query embeddings use an in-process 1,000-entry, 7-day LRU cache. These helpers are not called by the public search endpoint or results page.

## Historical deployment proposals

Separate Turso vectors storage, Cloudflare KV query caching, `vector_top_k()` indexed retrieval, and sub-50-ms latency targets appear in earlier design comments. They are not the merged search implementation at `4c94bf2`. There is no verified migration command here: create and test an actual transfer, schema and runtime change before operating a separate vector database. Float32 storage compatibility alone does not establish a deployed split or latency measurement.

See [corpus and data platform](../../docs/CORPUS-AND-DATA-PLATFORM.md) for storage responsibilities and [operations](../../docs/OPERATIONS-AND-QUALITY.md) for credentials and checks.
