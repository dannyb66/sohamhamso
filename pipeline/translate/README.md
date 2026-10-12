# Translation pipeline

Sanskrit-grounded candidate generation, model judging, bounded Indic fan-out, and shard merging. Read [AI systems and evaluation](../../docs/AI-SYSTEMS-AND-EVALUATION.md) for the authoritative inputs, exact model/display-version distinction, evaluation limits and observed corpus provenance. [STATUS-CONTRACT.md](../../STATUS-CONTRACT.md) defines the intended public status/badge contract; imported statuses do not by themselves prove a judge pass.

## Files and interfaces

| File | Purpose |
|---|---|
| [runner.ts](runner.ts) | Reads missing-language units, generates and judges, inserts draft/published translations, emits `RunSummary` with `--json` |
| [dispatch.ts](dispatch.ts) | Eleven-language fan-out, default concurrency 3, bounded transient retries and JSONL run manifest |
| [merge_indic.py](merge_indic.py) | Validates whole-text/per-chapter shards and carries their provenance into corpus YAML |
| [merge_glosses.py](merge_glosses.py) | Merges generated multilingual gloss data into YAML |
| [v1-sanskrit-grounded.md](prompts/v1-sanskrit-grounded.md) | Sanskrit-first translation prompt |
| [v1-judge.md](prompts/v1-judge.md) | Sanskrit-fidelity rubric, score ≥7 candidate publication threshold |
| [Woodroffe reference notes](anchors/woodroffe-references.md) | Bibliographic reference inventory |

## Local dry run

Dependencies, including `@anthropic-ai/sdk`, already appear in `package.json`:

```bash
bun install
bun run db:build
bun pipeline/translate/runner.ts --text siva-sutras --lang hi --limit 1 --dry-run --json
```

No API key is required for a runner dry run; it reads the DB and inserts no translations. Complete baseline coverage means the example reports zero pending units. The main AI documentation includes an isolated fixture example that exercises prompt construction. Use `--db` to select a trial database.

A dispatch dry run also writes a local run manifest, but makes no provider requests:

```bash
bun pipeline/translate/dispatch.ts --text siva-sutras --langs hi,ta --limit 1 --dry-run --runs-dir /tmp/sohamhamso-translate-review
```

## Live execution and recovery

A run without `--dry-run` uses `ANTHROPIC_API_KEY`, incurs API charges and writes the selected database. The runner skips model calls if it cannot construct a client; inspect `skipped` as well as exit status. Dispatch accepts `--concurrency`, `--max-attempts`, `--backoff-ms`, `--db`, `--langs`, `--limit` and `--runs-dir`. Its retries re-query units lacking any target-language translation, preserving successes; an existing draft is not automatically retried.

The runner calls the API model `claude-sonnet-4-5-20250929`, stores that in `model_version`, and stores logical label `claude-sonnet-4-6` in `model`. Current corpus shards record Opus labels independently. Keep those distinctions in provenance. Prompt revisions should use new identifiers rather than silently changing the meaning of existing row metadata.

Malformed JSON and per-unit provider failures are recorded; the runner exits 2 for failed units and dispatch exits nonzero for failed chunks. Transient retries use exponential backoff; there is no merged centralized rate-limit gateway. Candidate glosses, judge rationale/concerns and full audit records are not persisted by this runner.

The runner reads stored morphology/glosses; it does not ingest the separate Vidyut audit output or write candidate word glosses. Public-domain reference inputs are currently citations/notes, not full verse-level English anchors. The [morphology runbook](../morph/README.md) explains deterministic comparison and its limits.

Translation writes exist only in the DB until accepted content is merged into YAML. Corpus ingestion reconciles against YAML and can remove database-only translations. Review the source diff before rebuilding. `merge_indic.py` requires Python `ruamel.yaml`, validates chapter files/unit keys before writing each text, and downgrades `[draft] ` entries; it does not itself judge translations.

Historical per-verse cost estimates, claims that the judge catches “most” hallucinations, nightly reviewed-only embedding, and scheduled calibration audits are not measured or implemented guarantees. Consult the main AI reference for current limits and [the corpus reference](../../docs/CORPUS-AND-DATA-PLATFORM.md) for ingestion/export behavior.
