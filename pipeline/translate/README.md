# Translation pipeline

Sanskrit-grounded AI translation pipeline for sohamhamso. Generates AI translations of corpus verses with full provenance, scores them against a Sanskrit-fidelity rubric, and writes them into the `translations` table.

The contract for status, badges, and provenance fields is
[`STATUS-CONTRACT.md`](../../STATUS-CONTRACT.md). The grounding philosophy
(Sanskrit + Vidyut morphology + Cologne MW + meter — NOT English anchor) is
non-negotiable per Codex review refinements A + B in the plan.

## Files

| Path | Purpose |
|---|---|
| `prompts/v1-sanskrit-grounded.md` | Translation prompt template. `{{placeholders}}` substituted by the runner. |
| `prompts/v1-judge.md` | LLM-as-judge prompt. Scores Sanskrit fidelity 1–10. |
| `anchors/woodroffe-references.md` | PD English reference index per text. Reference signals only — not anchors. |
| `runner.ts` | Bun script. Reads verses needing translation, calls Claude, judges, writes results. |

## Usage

Initialise the DB first (one-time):

```bash
bun pipeline/ingest/init-db.ts
```

Install the Anthropic SDK (not yet a project dependency — installed separately to keep the scaffold pre-API):

```bash
bun add @anthropic-ai/sdk
```

Set the env var:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Run the pipeline against one text + one language:

```bash
bun pipeline/translate/runner.ts --lang en --text siva-sutras
```

Limit the run (smoke test before full corpus fan-out):

```bash
bun pipeline/translate/runner.ts --lang en --text siva-sutras --limit 5
```

Dry-run (no API calls, no DB writes — prints what would happen):

```bash
bun pipeline/translate/runner.ts --lang en --text siva-sutras --dry-run
```

Override the DB path (useful for tests):

```bash
bun pipeline/translate/runner.ts --lang en --text siva-sutras --db /tmp/test.db
```

### Indic fan-out

Per plan workstream 4, the same runner serves all 11 target languages. Run one process per language; they are independent:

```bash
bun pipeline/translate/runner.ts --lang hi --text siva-sutras &
bun pipeline/translate/runner.ts --lang ta --text siva-sutras &
bun pipeline/translate/runner.ts --lang te --text siva-sutras &
# ... etc for bn, mr, gu, pa, kn, ml, or, as
wait
```

The Indic fan-out is NOT gated on English review per Codex review refinement D (V1 ships AI-only). Each language grounds independently on the Sanskrit-side inputs.

## Env vars

| Var | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes for live runs | Claude API key. If missing, the runner warns and skips live calls (dry-run still works). |

## Cost estimate

From the plan (Translation Pipeline §6):

- V1 corpus (Phase 1, ~310 verses) × 11 languages × ~$0.015/verse ≈ **$50**
- Phase 2 (~2.3k verses) × 11 ≈ **$450**
- Phase 3 (~10k verses) × 11 ≈ **$2,000**

Numbers include the judge pass (each verse is scored once per generated translation). They do not include re-runs after prompt revisions, so budget 1.5–2x for prompt iteration during V1 ramp.

## Failure modes

- **Rate limits.** The runner inserts a `RATE_LIMIT_SLEEP_MS` sleep (1.5s default) between calls. This is a placeholder. The real solution is the shared rate-limit gateway Worker (plan eng-review refinement 2) that fronts both Anthropic and OpenAI for all pipeline workstreams. Until it lands, expect occasional 429s on parallel runs — back off and retry.
- **Judge calibration drift.** LLM-as-judge scores can drift over weeks. The contract requires a quarterly human spot-check audit of 50 random `published` translations per language to validate calibration (see `STATUS-CONTRACT.md`). When calibration drifts, freeze `prompt_version` (don't silently update the judge prompt), version-bump (`v2-judge`), and re-score affected translations.
- **Hallucination.** The judge catches most lexicon-divergent hallucinations (gloss does not appear in Cologne MW + Apte for the lemma). Edge cases survive: when the morphology itself is wrong (Vidyut error), the judge will reward agreement with the wrong morphology. Mitigation: log all candidates with `confidence < 0.5` and judge `score >= 7` for manual review — these are the high-confidence-low-morph-confidence cases most prone to silently propagating Vidyut errors.
- **Empty morphology.** Verses that have not yet been processed by the morph agent will fall through with `(no morphology data available)` injected into the prompt. The translation runner still works but Sanskrit-grounding degrades to lexicon-only. Run the morph agent first per workstream order.
- **PD reference coverage.** Most V1 corpus texts have no PD English reference (Śiva Sūtras, Spanda Kārikās, Pratyabhijñā Hṛdayam, most of Vijñāna Bhairava). The `{{pd_english_reference}}` placeholder is set to a clear "no reference available — ground on Sanskrit alone" sentence in those cases. This is correct behavior, not a bug.
- **Cross-process DB writes.** `bun:sqlite` opens the DB in WAL mode (set by `init-db.ts`). Parallel runners (Indic fan-out) write into the same DB. UNIQUE constraint `(verse_id, lang, translator)` prevents duplicates if two processes accidentally pick the same verse + lang.

## What this pipeline does NOT do

- It does not write `word_glosses` rows. That is the morph agent's responsibility (plan workstream 2 + 4). The runner reads existing glosses; it does not produce them.
- It does not embed translations. That is the embedding agent's responsibility (workstream 8), runs on `status='reviewed'` rows nightly.
- It does not promote `draft → reviewed`. Promotion is human review (V1.x), surfaced through a separate review-queue tool (workstream 7).
- It does not handle judge calibration audits. Audits are a runbook task — see `STATUS-CONTRACT.md` for the schedule.

## Prompt versioning

`prompt_version` is written into each `translations` row. Never edit `v1-sanskrit-grounded.md` or `v1-judge.md` in place after the first published run — version-bump to `v1.1-...`, then backfill if needed. The contract guarantees that `prompt_version` is stable per-row.
