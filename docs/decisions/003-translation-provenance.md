# 003 — Keep translation provenance distinct from publication and human review

- **Documented:** 2026-10-12.
- **Evidence baseline:** `origin/main` `4c94bf2`.
- **Status:** Reconstructed decision from implemented interfaces and the contemporaneous [translation status contract](../../STATUS-CONTRACT.md). This is not a claim that a new architecture change was approved or deployed on this date.

## Context

A shared multilingual corpus feeds reader pages, dataset exports and video manifests. A fluent translation can be model-generated, human-authored, judge-accepted or human-reviewed. Combining those meanings into one “complete” flag would hide whether users should trust an interpretation and whether a downstream artifact can be traced to the text it used.

## Decision evidenced by code

Store `ai_assisted` independently of `status` (`draft`, `published`, `reviewed`), retain translator/source/license, and carry nullable model, model-version, prompt-version, judge-score and reviewer fields. Expose AI-assisted publication as unverified until human review is recorded. Filter drafts out of public text reads and exported datasets. Pin the chosen translation row in video state so content reconciliation cannot silently orphan a published media artifact.

Evidence: [schema.sql](../../db/schema.sql), [translation runner](../../pipeline/translate/runner.ts), [badge state resolver](../../src/lib/ai-badge-state.ts), [badge tests](../../tests/unit/ai-assisted-badge.test.ts), [ingestion reconciliation](../../pipeline/ingest/ingest.ts), [reconciliation tests](../../tests/unit/ingest-reconcile.test.ts), and [dataset publisher](../../pipeline/dataset/publish.ts).

## Tradeoffs

The three states plus a separate AI flag keep existing consumers simple and allow human/AI lineage without a larger workflow enum. Nullable provenance makes legacy imports possible, but consumers must tolerate missing evidence. The model label and exact API version are separate fields; both must be inspected, because the runner's logical Sonnet label differs from its API model constant. A foreign key from media to translations protects lineage but can intentionally block corpus cleanup until pinned media is handled.

Sanskrit-first prompts avoid using English-reference similarity as the primary correctness target, yet storing gloss/morphology strings is weaker than retaining verified tool outputs and input hashes. A model judge can automate a candidate gate, but same-model judging and incomplete audit persistence prevent treating its score as expert validation.

## Actual enforcement and gaps

The runner implements score ≥7 promotion; SQLite does not enforce a score range or score/status consistency. The shard merger can import `published` content without any judge result. In the measured baseline all 36,276 translations are published, only 2,689 have a score, and none have a reviewer. That supports a publication/provenance architecture; it does not support an assertion that every row was evaluated or human-accepted.

Prompt version names are stored but prompt hashes, complete candidate payloads, judge rationale/concerns and calibration audits are not durably retained by the runner. Embedding selection also lacks a translation-status gate and content-hash invalidation. These are known limitations in [AI systems and evaluation](../AI-SYSTEMS-AND-EVALUATION.md), not newly implemented behavior.

## Alternatives considered retrospectively

A single publication flag would simplify callers but erase human-review distinctions. Requiring complete provenance on every historical import would improve auditability but reject existing source material. A richer revision/audit ledger would support reproducibility and review transitions better, at the cost of additional schema and workflow changes outside this documentation task.

## Verification and consequences

The badge matrix, draft-filtered reads/export tests and pinned-translation reconciliation make the intended boundary reviewable. Contributors must preserve source attribution and AI lineage when merging translations, inspect imported statuses separately from scores, and settle media lineage before removing pinned rows. Human review and held-out calibration remain separate responsibilities. Do not infer permission to redistribute content from either publication status or an AI provenance flag.
