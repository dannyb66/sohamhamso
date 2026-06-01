# Translation Status Contract

Public contract for how translation status values, the AI-assisted flag, and the badge UI relate. This is the canonical source for any developer rendering verse-anatomy data from our dataset or API.

## State table

| `(ai_assisted, status)` | Meaning | Badge label | Badge color | Public display? |
|---|---|---|---|---|
| `(true, 'draft')` | AI-generated, no LLM-judge pass yet | "AI · pending review" | amber + spinner | NO — reviewers only |
| `(true, 'published')` | AI-generated, passed LLM-judge ≥7/10 Sanskrit-fidelity | "AI · not verified" | amber pill | YES |
| `(true, 'reviewed')` | AI-generated + human reviewer accepted | "AI · reviewed by {name}" | emerald pill | YES, with reviewer credit |
| `(false, 'published')` | Public-domain or original human translation | "{translator} · {year} · PD" or "Trans. by {name}" | slate pill | YES |
| `(false, 'draft')` | Reserved for human translations awaiting review | "Pending review" | amber | NO — reviewers only |
| `(false, 'reviewed')` | Reserved for human translations accepted | "Trans. by {name} · reviewed" | emerald | YES |

The 5-state enum expansion (`ai_human_revised`, `human_reviewed`) lands in V1.1 per the plan's deferred-tradeoff. V1 uses the 3-state enum (`draft | reviewed | published`) plus the `ai_assisted` boolean to derive the badge.

## LLM-as-judge rubric (Sanskrit-fidelity)

The judge scores each translation 1–10 against the **Sanskrit verse + Vidyut morphology + Cologne MW glosses + meter tag** — NOT against an English anchor. Public-domain English translations are passed to the judge as *reference signals only*; the judge is instructed to trust Sanskrit + morphology when they conflict with the PD English.

Pass thresholds:
- `≥ 7` to promote `draft → published`
- `≥ 8` to mark a translation "high-confidence" (rendered as a subtle badge variant in V1.x)
- `< 7` stays `draft` and is excluded from public display

Calibration: quarterly human spot-check audit of 50 random `published` translations per language to validate judge calibration. Audit results recorded in `audit_log` table (V1.1).

Judge inputs:
- Devanāgarī verse
- IAST + SLP1 transliterations
- Vidyut morphological segmentation (lemmas, case/number/gender, sandhi splits)
- DCS lemma data (where coverage exists)
- Cologne C-SALT MW + Apte glosses per lemma
- Skrutable meter tag
- Citation-aware context (preceding 2 verses in same text)
- Optional reference signal: PD English translation, marked as reference-not-anchor

Judge output: `{ score: 1-10, rationale: string, concerns: string[] }`. Stored in `translations.judge_score` + audit log.

## Provenance fields

Every translation row includes:
- `ai_assisted: boolean` — whether AI generated the original draft
- `status: 'draft' | 'reviewed' | 'published'` — review-pipeline state
- `model: string?` — e.g., `claude-sonnet-4-6`
- `model_version: string?` — full version identifier
- `prompt_version: string?` — versioned reference to `pipeline/translate/prompts/*.md`
- `judge_score: real?` — 1–10 from the LLM-as-judge
- `translator: string?` — human translator name (for `ai_assisted=false`) or null
- `reviewer: string?` — human reviewer name (for `status='reviewed'`) or null
- `reviewed_at: timestamp?`
- `license: string` — per-translation license (CC-BY-SA 4.0 default; PD for pre-1930 translators)
- `source: string?` — citation string

## Rendering rules for client implementations

1. Read `(ai_assisted, status)` per translation row.
2. Render the badge per the state table above. Badge MUST be inline-visible with the verse number, never hidden behind a tooltip.
3. Tap badge → open provenance panel showing `model`, `model_version`, `prompt_version`, `generated_at`, `judge_score`, `reviewer`, `reviewed_at`. Link to this contract document.
4. NEVER mix translation text across `(ai_assisted, status)` pairs in a way that obscures which provenance applies.

## Stability guarantees

- The 3-state `status` enum is stable for V1.
- The `ai_assisted` boolean is stable.
- The 5-state expansion (V1.1) adds values; it does not remove or rename existing values.
- Badge color mapping (amber/emerald/slate) is stable; specific shades may shift to maintain WCAG AA contrast across themes (light/sepia/dark/OLED).
- Provenance fields `model`, `model_version`, `prompt_version` are nullable but never removed.
