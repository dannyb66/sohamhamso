# Scripture Ingestion Pipeline — sohamhamso

> From discovery to public launch. Use this runbook to add a new text end-to-end.
> Maintained by the Phase 1 ingestion lessons; update on each new text.

Companion docs:
- Plan: `/Users/deepakbasavaraju/.claude/plans/check-online-websites-aim-sparkling-pearl.md`
- Status contract: `STATUS-CONTRACT.md` (per-translation badge + status semantics)
- Per-source attribution: `ATTRIBUTION.md`
- Dataset publisher contract: `pipeline/dataset/README.md`
- Translation pipeline contract: `pipeline/translate/README.md`
- QA reports referenced throughout: `.gstack/qa-reports/qa-report-localhost-2026-06-01*.md`
- Deployment plan: `.gstack/launch/deployment-plan-2026-06-01.md`

---

## TL;DR — the 12 steps

1. Discover the text (corpus position, demand signal, plan phase).
2. Source the Sanskrit (GRETIL first, Muktabodha if needed, fallback chain).
3. Audit license (per-source license matrix, MIRI contact path).
4. Normalize encoding (SLP1 / Devanāgarī / IAST, danda handling, verse numbering).
5. Author the YAML corpus file (`data/corpus/{slug}.yaml`).
6. Verify verse count vs printed edition.
7. Run morphology pipeline (Vidyut-cheda + Cologne MW).
8. Generate English translation (one agent, Sanskrit-grounded prompt).
9. Fan out to 11 Indic languages (parallel agents, one per lang).
10. Validate schema + sweep `[draft]` markers + run unit lint.
11. Ingest into DB + verify via cross-lang matrix.
12. Add to launch + publish dataset on release tag.

---

## Step-by-step

### Step 1 — Discover

- **Which Phase (1-4)?** Plan §"Corpus & Build Phases" maps each text to a phase. Phase 1 (MVP) shipped: Śiva Sūtras, Spanda Kārikās, Pratyabhijñā Hṛdayam, Vijñāna Bhairava Tantra, Karpūrādi Stotra. Phase 2 next-up: Paratrīśikā, Iśvarapratyabhijñā Kārikā, Śivadṛṣṭi, Tantrasāra, Gītārtha Saṃgraha, Mahānirvāṇa Tantra.
- **Demand signal:** any scholar/practitioner request? Codex-flagged demand thesis is still unproven — measure 60-day post-launch traction (subscribe rate, return visits, citations) before committing budget to Phase 2-4.
  - **Demand-gate note (2026-06-10):** launch anchor pinned **2026-06-08** (GSC + Bing verified — same anchor as `.github/workflows/seo-phase8.yml`). The 60-day gate was **overridden 2026-06-10** at the `/autoplan` review to start Phase 2 foundations early. Demand evidence is now collected continuously: `scripts/demand-dashboard.ts` (weekly cron, `.github/workflows/demand-dashboard.yml`) + the `search_misses` instrument (`src/lib/search-miss.ts`). **Waves 3–6 checkpoint: ~2026-07-10** against pre-registered thresholds — operator MUST fill the threshold column BEFORE the checkpoint date, not after seeing the actuals:

    | Metric (trailing window, per dashboard) | Pre-registered threshold | Actual @ checkpoint |
    |---|---|---|
    | Subscriber total | TBD | TBD |
    | Subscriber growth (7d) | TBD | TBD |
    | GSC impressions / clicks (7d) | TBD | TBD |
    | CF Web Analytics pageviews / visits (7d) | TBD | TBD |
    | Search misses matching Phase 2 texts (28d) | TBD | TBD |
    | Phase 2 slug 404/alias hits (7d) | TBD | TBD |
- **Auto-commentary check:** does the text have a commentary (e.g. Kṣemarāja's Vimarśinī on the Śiva Sūtras) that ships as a sibling text? Per locked decision: commentaries are first-class texts with a `parent_text_id` link, NOT a nested layer under the parent verse. Reserve a sibling slug at discovery time so future commentary ingestion does not collide.
- **Non-verse-shaped texts** (mostly-prose, fragmentary, variant-witness): expect to force-fit into `chapter/verse_num` for V1 and document the compromise in the YAML `description`. V1.x will add `section_type` + `prose_block_ref`.

### Step 2 — Source the Sanskrit

| Priority | Source | License | When to use |
|---|---|---|---|
| 1 | **GRETIL** (`https://gretil.sub.uni-goettingen.de/`) | per-file CC-BY (header-parse) | Default. Cleanest derivative path. |
| 2 | **Muktabodha / MIRI** (`muktalib7.com`) | scholarly-use; **redistribution requires written permission per text** | When GRETIL doesn't have it. **Block dataset publish until MIRI letter received** — applies to the entire MIRI track, not a single text. |
| 3 | **sanskritdocuments.org** | NC; non-profit use with credit | Fallback where GRETIL + MIRI are absent. |
| 4 | **SARIT** (TEI-XML) | scholarly use | Cleanest schema; Pratyabhijñā-school commentaries. |
| 5 | **Wikisource Sanskrit** | CC-BY-SA 4.0 + GFDL | Last resort, license-clean fallback. |

Record the exact source location, revision, and accessed-on date in the YAML (`source`, `source_url`, `source_revision`) and in `ATTRIBUTION.md`. Capture the upstream text file (or HTML) to a local working dir before normalizing so the next contributor can diff revisions. [TODO: confirm preferred provenance-capture path with maintainer — Phase 1 was captured ad-hoc; no `pipeline/sources/` fetcher exists yet.]

### Step 3 — License audit

- Cite source per-file in `data/corpus/{slug}.yaml` under the `source`, `source_url`, `source_revision`, `license`, and `attribution_html` keys (see schema below).
- Append per-source attribution to `ATTRIBUTION.md`. The existing per-source block (GRETIL / MIRI / sanskritdocuments / Wikisource / Cologne / Vidyut / DCS / Skrutable / Sanscript / Aksharamukha) is the canonical template.
- If the text is Muktabodha-derived: add it to the MIRI permission queue and flag the YAML with a `pending_miri: true` field (a first-class optional field in the corpus schema; note the schema is `.strict()`, so any field NOT in the schema aborts ingest — downstream tooling/scripts gate Zenodo publish on this) — until the MIRI letter is in, the published dataset bundle MUST omit this text. The deployment plan and `ATTRIBUTION.md` both call this out: the entire MIRI track is "**pending**". The gate is implemented: `pipeline/dataset/publish.ts` reads `pending_miri` from the corpus YAMLs and excludes held texts from every CSV/JSON/TEI shard and the stats (the Zenodo deposit consumes that output, so it inherits the hold).

### Step 4 — Normalize encoding

- **Canonical primary:** Devanāgarī. SLP1 + IAST optional but recommended per verse.
- **Devanāgarī source check:** `pipeline/ingest/ingest.ts::isDevanagari()` accepts any string with at least one code point in U+0900–U+097F. `toDevanagari()` round-trips IAST through Sanscript when needed. Mixed strings take the no-op path.
- **Danda handling:** preserve raw dandas (`।`, `॥`) and bracketed verse numbers (e.g. `॥४९॥`) in the YAML source string. The render-time helper `formatDanda()` in `src/components/VerseAnatomy.astro` performs the half-verse line break — do NOT pre-split lines in the YAML. (See commit `5dba55e` — "break Sanskrit verses on the half-verse danda".)
- **Verse numbering:** `chapter.verse_num` keyed (e.g. `1.47`). Numbers must be integers in the YAML (`chapter: 1`, `verse: 47`); the ingest accepts both `verse` and `verse_num` aliases.
- **Slug naming:** lowercase kebab-case using simple Latin-equivalents — `pratyabhijna-hrdayam` (not `pratyabhijñā-hṛdayam`). The slug alias table in `src/lib/aliases.ts` handles common romanization variants (`hridayam ↔ hrdayam`, `shiva ↔ siva`, `karpuradi-stotram → karpuradi-stotra`, etc.) via 301 redirects from `getStaticPaths`. Add a new entry to `SLUG_ALIASES` whenever your text has multiple common spellings — sound-equivalence rules of thumb are in the source comments (vocalic ṛ → r/ri, ś → s/sh, long ū → u/uu, sandhi → spelled-out).

### Step 5 — Author the YAML corpus file

- **Path:** `data/corpus/{slug}.yaml` — one file per text. The ingest discovers corpus files by directory scan and alphabetical filename order, but skips underscore-prefixed templates and `*.faq.yaml` siblings.
- **Canonical reference:** `data/corpus/_template.yaml` is the contributor template — copy it and edit.
- **Two accepted shapes:** flat (top-level fields + `chapters:`) OR wrapped (`text: {...}` + sibling `chapters:`). Either works (see `parseTextYaml` in `pipeline/ingest/ingest.ts`). Phase 1 uses the wrapped form.
- **Optional SEO-only fields:** top-level `seo` and `faq_file` are validated during ingest, but they are consumed by the SEO builders rather than stored in SQLite.
- **FAQ siblings:** when `faq_file` is present, it must point at a sibling `./{slug}.faq.yaml` file. Use `data/corpus/_template.faq.yaml` + `data/corpus/faq.schema.json` for authoring.
- **Required top-level fields:** `id`, `slug`, `title_sa`, `title_en`, `tradition`, `license`. Optional but recommended: `title_iast`, `author`, `school`, `era`, `source`, `source_url`, `source_revision`, `attribution_html`, `parent_text_id` (for sibling commentaries), `manuscript_url`, `description`.
- **Required per-verse fields:** `verse_num` (or `verse`), `devanagari`. Optional: `book`, `slp1`, `iast`, `meter`, `manuscript_folio_ref`.
- **Per-verse `word_glosses`** are an inline list. Each gloss entry uses `word` or `word_sa` for the surface form, optional `lemma_sa` / `lemma_iast` / `morph`, and EITHER `gloss_en` / `gloss_text` for the English gloss OR per-language `gloss_xx` keys (`gloss_hi`, `gloss_ta`, `gloss_pa`, `gloss_or`, …) — the ingest accepts a 2-letter ISO code and emits one `word_glosses` row per `(verse, word_idx, gloss_lang)`. **This `gloss_xx` field pattern is correct ONLY in the YAML corpus file**; the per-lang JSON files in `data/glosses/{slug}/{lang}.json` use the canonical `gloss_text` field (see Case 3 below).
- **Per-verse `translations`** are an inline list. Each entry takes `lang`, `translation_text` (or `text`), `license`, `status` (`draft` / `reviewed` / `published`), `ai_assisted` boolean, and optional provenance fields (`translator`, `source`, `model`, `model_version`, `prompt_version`, `judge_score`, `reviewer`, `reviewed_at`).
- **Editing in place:** if you need to edit YAML programmatically post-ingest (e.g. the `[draft]` sweep in Step 10), use `ruamel.yaml` with `preserve_quotes = True` and `width = 10_000` so block-scalar formatting and inline comments survive. `pipeline/clean-draft-prefix.py::clean_yaml_corpus()` is the working example.

### Step 6 — Verify verse count

- Spot-check against the printed edition's known count. Phase 1 counts pinned in the plan: Śiva Sūtras = 77 sūtras; Spanda Kārikās = 52 verses; Pratyabhijñā Hṛdayam = 20 sūtras; Vijñāna Bhairava Tantra = 163 dhāraṇās; Karpūrādi Stotra = (short, ~22 verses). Phase 1 ingest total: **334 verses across 5 texts × 12 langs = 4,008 translations + 28,018 word-glosses** (per QA pass-1 report).
- Spot-check 5 random verses against the upstream source (string compare; account for danda + verse-number bracket normalization).
- [TODO: add an `expected_verse_count` top-level field to the YAML schema + a validator in the ingest so this check runs automatically.]

### Step 7 — Run morphology

- **Scaffold status:** `pipeline/morph/` is an empty directory in this repo. The plan's design says Vidyut-cheda → Cologne C-SALT MW + Apte → emits `lemma_sa`, `lemma_iast`, English gloss, and `morph` field into `word_glosses` (with `gloss_lang='en'`). [TODO: implement `pipeline/morph/runner.ts` per plan workstream 2 — Phase 1 word_glosses were authored by the translator agents directly, not by an automated morph pass.]
- Until the runner lands, the substitute is: the English gloss + morph string come from the same Sanskrit-grounded prompt the translator agent runs (Step 8), then the Indic fan-out (Step 9) adds per-language `gloss_xx` entries against the same `word_idx` ordering.

### Step 8 — Generate English translation

- **Prompt template:** `pipeline/translate/prompts/v1-sanskrit-grounded.md` (the canonical template — `prompt_version: v1-sanskrit-grounded`). Model: Claude Sonnet 4.6, temperature 0.2, strict-JSON output.
- **Locked grounding philosophy:** Sanskrit verse + Vidyut morphology + Cologne MW/Apte glosses + meter are the load-bearing inputs. **NEVER anchor on a PD English translation** — PD English (Woodroffe, Bühler, Thibaut) is a *reference signal*, never the source of truth. If the Sanskrit + morph disagree with the PD English, trust the Sanskrit + morph and record the deviation in the `deviations_from_pd_english` field.
- **Output written to:** `data/translations/{slug}/en.json` (JSON shape: `{ text_slug, lang, translator, license, prompt_version, ai_assisted, status, verses: { "1.1": "...", "1.2": "...", ... } }`) and the corresponding `data/glosses/{slug}/en.json`. The translator agent ALSO inlines the same content into the corpus YAML's per-verse `translations` and `word_glosses` arrays for the canonical ingest path.
- **Judge pass:** `pipeline/translate/prompts/v1-judge.md` (`prompt_version: v1-judge`, temperature 0.0). Scores Sanskrit fidelity 1–10. Pass threshold = 7 to publish at `ai_assisted=true, status='published'`; 8 marks "high-confidence". Quarterly human spot-check (50 random published translations per language) per `STATUS-CONTRACT.md`.

### Step 9 — Fan out to 11 Indic languages (the parallel-agent pattern)

The 11 Indic target languages: Assamese (`as`), Bengali (`bn`), Gujarati (`gu`), Hindi (`hi`), Kannada (`kn`), Malayalam (`ml`), Marathi (`mr`), Odia (`or`), Punjabi (`pa`), Tamil (`ta`), Telugu (`te`). Plus English (`en`) = 12 langs total.

**The pattern that works** (from Phase 1 lessons):

- **One agent per language.** 11 agents in parallel, dispatched in background mode.
- **Each agent gets:** target lang code + native name + expected Unicode block range, the canonical Sanskrit-side inputs (Devanāgarī + IAST + morph + Cologne glosses + meter), the EN translation as one reference signal among many (NOT anchor), the output file paths, and explicit scope guardrails.
- **Forbidden in every prompt:**
  - "Do NOT touch other lang files (`data/translations/{slug}/{other_lang}.json` or `data/glosses/{slug}/{other_lang}.json`)."
  - "Do NOT touch `data/corpus/*.yaml` directly — per-text, sibling agents would collide on the same file. Emit only the per-lang JSON; the corpus YAML is updated in a single follow-up pass after all 11 land."
  - "Do NOT run `git add -A`. Stage your own per-lang files by name."
- Each agent commits its own atomic per-lang file. Conventional commit message format used in Phase 1: `feat(i18n): {native name} ({code}) translation dictionary` (see commits `163878a` Hindi, `a2ac9ac` Marathi, `f42f613` Bengali, `419bb00` Assamese, `127df1b` Tamil, `54eb6de` Gujarati, `4dc574e` Punjabi, `12022c4` Telugu, `5b9dac0` Kannada, `64394fa` Odia, `fce0486` Malayalam).

**Socket-error mitigations for large texts** (the Vijñāna Bhairava lesson):

- For texts >150 verses, single-agent runs can socket-error around the 15–18 min mark on long Anthropic API streams. The pattern that worked for Vijñāna Bhairava Tantra (163 dhāraṇās): **split each per-lang agent into translation-only + glosses-only halves** — two atomic commits per language instead of one. [TODO: confirm exact split-commit hashes with maintainer — the task brief cites `a6201d37` + `aef4586f` for the Telugu split, but neither hash exists in this repo's git log. The verifiable content commit for the full 12-lang Vijñāna corpus is `61fb0b3` ("feat(content): full 12-lang corpus — Karpūrādi/Spanda/Vijñāna Indic").]
- For >500-verse texts (Iśvarapratyabhijñā 190 verses sits on the edge; Mahānirvāṇa ~2k verses; Tantrāloka ~5,800 verses): split per chapter instead of per text. Each agent owns `{slug}/{lang}/ch{N}.json` shards, then a final merge step concatenates.

**Schema deviations to guard against:**

The per-lang JSON files in `data/translations/{slug}/{lang}.json` and `data/glosses/{slug}/{lang}.json` use a STRICT canonical shape:

```
data/translations/{slug}/{lang}.json:
  { text_slug, lang, translator, license, prompt_version, ai_assisted, status,
    verses: { "1.1": "<translation string>", ... } }

data/glosses/{slug}/{lang}.json:
  { text_slug, lang, translator, license, ai_assisted, status,
    verses: { "1.1": [ { word_idx: 0, gloss_text: "..." }, ... ], ... } }
```

The field name is **`gloss_text`** — exactly that, no lang-suffix, no extra entry-level fields. The Punjabi and Odia translator agents historically freelanced (Punjabi emitted `gloss_pa`, Odia added an extra entry-level `iast` field) — both required a Python rename pass to align with the canonical shape. The recovery cost ran roughly an hour per deviation. [TODO: confirm exact rename-script commits with maintainer — no rename-pass commits are present in the current git log; the deviation history is recounted here from prior session memory, but the working `data/glosses/{slug}/pa.json` and `or.json` files today use the canonical `gloss_text` shape — see `data/glosses/siva-sutras/pa.json` for the post-fix state.]

**Prevention:** every translator agent prompt MUST pin the schema in words, not just by example. The canonical phrasing:

> "Use field name `gloss_text` EXACTLY. Do NOT use lang-suffixed variants like `gloss_pa` or `gloss_or`. Do NOT add extra entry-level fields (e.g. `iast`, `lemma_iast`). The only keys per gloss entry are `word_idx` (integer) and `gloss_text` (string)."

(Note: the `gloss_xx` lang-suffix pattern IS legitimate in the corpus YAML — see Step 5 — because the ingest reads `gloss_{lang}` keys and emits per-language rows. The deviation problem is specifically about the per-lang JSON files; do NOT "fix" the YAML pattern.)

**Distinguishing-feature checks for shared-script langs** (added per QA pass-2 audit pattern, 2026-06-01):

- **Marathi (`mr`) vs Hindi (`hi`)** — both render in Devanāgarī. Hindi uses possessives `का / की / के`; Marathi uses `चा / ची / चे / च्या`. Audit by grepping the per-lang JSON for the genitive postposition.
- **Assamese (`as`) vs Bengali (`bn`)** — both render in the Bengali Unicode block. Assamese uses `ৰ` (U+09F0) + `ৱ` (U+09F1); Bengali uses `র` (U+09B0). Audit by grepping for U+09F0.
- Per-lang audit agents in pass-2 caught both. Reuse the audit-prompt pattern (Template B below) for any new shared-script lang pair.

### Step 10 — Validate

- **Schema lint:** confirm all 12 per-lang files match the expected shape (Step 9 schema block).
- **`[draft]` marker lint:** `bun run test tests/unit/no-draft-marker-leak.test.ts` — the regression lint added in commit `a66afc2` after pass-1 QA caught 608 leaks across (initially 67, eventually 69) files. The lint walks every JSON file under `data/translations/` and `data/glosses/`, scans translation strings AND gloss entries, and fails with the exact file + verse-key + 80-char excerpt for any `[draft]` (case-insensitive) hit.
- **If leaks found:** `python3 pipeline/clean-draft-prefix.py` — idempotent sweep of `data/translations/*.json`, `data/glosses/*.json`, AND `data/corpus/*.yaml` (the YAML pass uses `ruamel.yaml` round-trip with `preserve_quotes = True` and `width = 10_000` to keep block-scalar formatting). Runs in ~1 sec. The cleanup commit landed at `2da1cf0` ("fix(content): strip [draft] bracket-tag leak from translation + gloss bodies"); per-lang follow-ups at `41ac91e` (Telugu pratyabhijna 1.7, 1.18) and `5073489` (Bengali karpuradi 1.5, 1.14).
- **Full gate sweep:** `bun typecheck && bun run test && bun e2e && bun run check` — Phase 1 baseline (pass-2) is **0 typecheck errors, 148 unit pass, 168 e2e pass, 87 biome lints (all pre-existing style preferences, not blockers)**.
- **Console health:** zero console errors across 19 routes confirmed in pass-2.

### Step 11 — Ingest + verify

- **Verse routes are SSR (A6 phase 2) — Turso seeding is load-bearing for the READER:** the two verse routes (`/[tradition]/[text]/[chapter]/[verse]` and the `/[lang]/...` twin) are `prerender = false` and read the **prod Turso corpus DB** at request time (one batched libsql round-trip per page — `src/lib/verse-read.ts`). Until A6 phase 2, Turso only powered `/api/search` and OG images; now an unseeded or stale Turso means verse pages render the styled 503/404, not just degraded search. Operational consequence: **after ingesting a new text locally, the per-text Turso seeder (`scripts/turso-seed-corpus.ts`) + its backup gate are a REQUIRED deploy step**, sequenced before (or atomically with) the Pages deploy that links to the new verses. `astro dev` and `astro build` still read the local SQLite file via `bun:sqlite`; only the deployed worker hits Turso (`TURSO_CORPUS_URL` + `TURSO_CORPUS_AUTH_TOKEN` CF Pages secrets).
- **Deploy model (plan item A6):** `db/sohamhamso.db` is **not committed** — it is a build cache, not a source of truth. The sources are `data/corpus/*.yaml` + `db/schema.sql` (+ `db/migrations/` for already-provisioned DBs). Every build path is self-sufficient: `bun run build` / `bun run seo:build` start with `bun run db:ensure`, which runs `db:init` + `ingest` when the file is absent (CI and Cloudflare Pages clone a tree without the binary and rebuild it the same way). To force a clean rebuild locally: `rm db/sohamhamso.db && bun run db:build`. Scripts that read the local DB (e.g. `scripts/turso-seed-corpus.ts`) require `bun run db:build` first and die with that message if it is missing.
- **Initial DB setup (one-time):** `bun pipeline/ingest/init-db.ts` — applies `db/schema.sql` to `db/sohamhamso.db`.
- **Ingest:** `bun pipeline/ingest/ingest.ts` — reads every corpus text YAML in `data/corpus/` (excluding underscore templates and `*.faq.yaml`), validates optional `seo` / `faq_file` blocks, then runs each text in a `db.transaction()` block, idempotent via `ON CONFLICT … DO UPDATE`. Run options: `--db custom.db` and `--dir data/corpus`. Prints per-text and total row counts on success.
- **Schema (key tables — see `db/schema.sql` for canonical):**
  - `texts(id, slug, title_sa, title_en, title_iast, author, tradition, school, era, source, source_url, source_revision, license, attribution_html, parent_text_id, manuscript_url, description, updated_at)`
  - `verses(text_id, book, chapter, verse_num, devanagari, slp1, iast, meter, manuscript_folio_ref)` — unique on `(text_id, chapter, verse_num)`
  - `word_glosses(verse_id, word_idx, word_sa, lemma_sa, lemma_iast, gloss_lang, gloss_text, morph)` — unique on `(verse_id, word_idx, gloss_lang)`
  - `translations(verse_id, lang, translator, translation_text, source, license, status, ai_assisted, model, model_version, prompt_version, judge_score, reviewer, reviewed_at, updated_at)` — unique on `(verse_id, lang, translator)`
- **Expected row counts after ingest:** 1 row per text in `texts`, N rows in `verses`, N×12 rows in `translations` (1 per lang per verse, V1), N×W×12 rows in `word_glosses` (W = avg words per verse).
- **Phase 1 totals (sanity reference):** 5 texts × 334 verses × 12 langs = 4,008 translations + 28,018 glosses.
- **Verify via `src/lib/db.ts`:** `getVerse(slug, ch, v)` returns the single-lang verse anatomy for the reader; `getVerseAllLanguages(slug, ch, v)` returns `{ translations_by_lang, glosses_by_lang }` — used by the cross-lang matrix probe.
- **Cross-lang matrix probe (canonical health check):** for each `(text_slug, lang)` pair, hit `/{tradition}/{slug}/1/1` (or `/1/47` for Vijñāna), parse `window.__readerData`, assert `translations_by_lang[lang]` non-empty AND `glosses_by_lang[lang].length` matches the verse's `word_glosses` count. Phase 1 = 120 probes (5 texts × 12 langs × 2 assertions). Pass-2 QA confirmed **120/120 pass + 0 `[draft]` leaks across 4,008 cells.** Template in `.gstack/qa-reports/qa-report-localhost-2026-06-01-pass2.md` §"Phase D".

### Step 12 — Launch + dataset publish

- **Homepage curation:** if the new text deserves headline placement (e.g. a Phase 2 launch moment), update `src/components/CuratedEntries.astro` (and the `If you are new` / featured-verse rotation). New texts default to surfacing in `/{tradition}/` index pages and the `All texts (N)` list — no per-text wiring needed.
- **Tag a release:** `vYYYY.MM.DD` (e.g. `v2026.07.15`). Per `pipeline/dataset/publish.ts`, only this date-tag form passes the version regex. The publisher emits the bundle at `dataset/build/sohamhamso-dataset-{version}/` with CSV + JSON shards + minimal TEI per text, `checksums.sha256` written last, and `CHANGELOG.md` diffed against the previous build in `--out`.
- **What ships in the bundle:** `texts`, `verses`, `word_glosses`, `parallels` rows ship as-is. `translations` rows ship ONLY where `status IN ('reviewed','published')` — `draft` rows are reviewer-internal per `STATUS-CONTRACT.md`. `verse_embeddings`, `subscribers`, `api_quota`, `dataset_releases` NEVER ship.
- **Zenodo deposit:** `bun pipeline/dataset/zenodo-deposit.ts --dir dataset/build/sohamhamso-dataset-{version}/` (defaults to dry-run; pass `--execute` to publish). `--sandbox` hits `sandbox.zenodo.org`. Each run writes a `zenodo-deposit.json` provenance record into the bundle dir.
- **Muktabodha gating:** if ANY published text in the bundle is Muktabodha-derived AND the MIRI permission letter has not landed, **hold the Zenodo deposit**. The fallback per the deployment plan is to ship a v1.0 dataset with GRETIL + Wikisource + sanskritdocuments only and add Muktabodha-derived texts in a follow-up release once permission lands. The `pending_miri: true` gate in `publish.ts` enforces this automatically (a loud "MIRI PERMISSION HOLD" banner lists held texts; `held_texts` appears in the summary JSON).
- **Ambuda upstream PR (workstream 11):** one PR per text against `ambuda-org/ambuda`. Format conversion (SLP1 → Ambuda's TEI subset) is our responsibility. Title: `add {text-slug} from sohamhamso`. Body: metadata + source attribution + conversion notes. Cadence: per text, not per release. Skip Ambuda PR for any text where Ambuda's contributor policy excludes AI-assisted material — our dataset still publishes.

---

## Lessons learned (case studies)

### Case 1: Vijñāna Bhairava Telugu socket-error battle

- **Pattern:** for any text >150 verses, a single per-lang agent attempting translation + glosses in one streaming run hits an Anthropic API socket disconnect around the 15–18 min mark.
- **Mitigation:** split per-lang work into translation-only + glosses-only halves — two atomic commits per language. For texts >500 verses, split per chapter on top of that.
- **Generalizable:** Vijñāna Bhairava Tantra (163 dhāraṇās) triggered this on at least one lang (Telugu, per session memory). Iśvarapratyabhijñā (190 verses) will likely hit it on multiple langs; Mahānirvāṇa Tantra (~2k verses) and Tantrāloka (~5.8k) absolutely require per-chapter splits.
- **Verifiable commit anchor:** `61fb0b3` ("feat(content): full 12-lang corpus — Karpūrādi/Spanda/Vijñāna Indic") is the landing commit for the full 12-lang Vijñāna content. [TODO: confirm the exact per-lang split-commit hashes with maintainer — the task brief cites `a6201d37` + `aef4586f` for Telugu, but these are not present in this repo's git log.]

### Case 2: 608 `[draft]` marker leaks

- **Cause:** the translator-agent prompt convention used a `[draft] ` text prefix as a per-verse uncertainty signal that the ingest was supposed to consume (promoting that row's `status` to `draft`) and strip from the body. The stripping step was never implemented, so `[draft]` text leaked into rendered translations and glosses.
- **Surface:** 608 entries across 70 files (67 JSON + 3 YAML; eventually 69 files after extending the sweep to cover an `INLINE` mid-clause occurrence).
- **Fix (two parts):**
  - **Sweep:** `pipeline/clean-draft-prefix.py` — strips both leading-prefix and inline `[draft]` from translation strings + gloss entries + corpus YAMLs; idempotent; ruamel.yaml round-trip preserves block scalars. Commit `2da1cf0`.
  - **Lint:** `tests/unit/no-draft-marker-leak.test.ts` — fails the test suite on any `[draft]` reappearance with file + verse key + excerpt. Commit `a66afc2`.
  - Per-lang spot-fixes followed: `41ac91e` (Telugu pratyabhijna 1.7, 1.18) and `5073489` (Bengali karpuradi 1.5, 1.14).
- **Lesson:** every agent-prompt convention is a silent contract with the ingest pipeline. Either make it explicit on both sides (prompt + ingest) OR add a regression lint at the ingest boundary. The `[draft]` prefix was a convention only the prompt knew about.

### Case 3: Punjabi + Odia schema deviations

- **Cause:** the per-lang JSON shape for `data/glosses/{slug}/{lang}.json` is canonically `{ word_idx: number, gloss_text: string }` per entry. The Punjabi agent freelanced field names (emitted `gloss_pa` instead of `gloss_text`); the Odia agent added an extra entry-level `iast` field. Both deviations affected ~1,000 entries each in the original write.
- **Fix:** Python rename pass to coerce to the canonical shape (~1 hour to write + apply per deviation). The current `data/glosses/siva-sutras/pa.json` and `data/glosses/siva-sutras/or.json` are post-fix evidence — they use the canonical `gloss_text` field with no extra entry-level keys.
- **Prevention** (now in the agent prompt — see Step 9): pin the schema in words, not just by example. State which field names are forbidden ("Do NOT use `gloss_pa` or any lang-suffixed variant; do NOT add `iast` at the entry level").
- **IMPORTANT subtlety:** the `gloss_xx` lang-suffix pattern IS correct in the corpus YAML (`data/corpus/*.yaml`) — see `pipeline/ingest/ingest.ts` lines 282–301 where the ingest matches `/^gloss_([a-z]{2})$/` and emits per-language rows. The deviation problem is specifically about the per-lang JSON files. Future contributors must not "fix" the YAML pattern; it is load-bearing.
- [TODO: confirm exact rename-script commits with maintainer — these are not present in the current git log; the case is recounted here from prior session memory + post-fix file evidence.]

### Case 4: Subscribe API mismatch with reader-lang catalogue

- **Cause:** two sources of truth disagreed about which languages were "available". `SubscribeBand.astro` sourced its picker from `getAvailableLanguages()` (the corpus DB's published-language set — all 12). `src/pages/api/subscribe.ts` held its own local `ACTIVE_LANGUAGES = new Set(['en'])` because the V1 daily-verse send pipeline is English-only. Picker said "Hindi available"; API rejected the POST with HTTP 400 + `"That language isn't available yet"`. Dead-end submit.
- **Fix:** commit `439cd8d` extracted `src/lib/subscribe-langs.ts` exporting `ACTIVE_LANGUAGES` (V1 = `en` only) AND `KNOWN_LANGUAGES` (all 12, used by the API's "unknown lang" distinction). Both surfaces now import from there. Picker renders 11 langs as `disabled` with a "(soon)" suffix; API rejects with the same per-lang rationale. Regression test at commit `2a15a21` pins the contract (4 assertions).
- **Lesson:** anywhere two surfaces describe the same set, extract a shared module. The same pattern is now mirrored by `src/lib/reading-modes.ts` for the Masthead picker / ScriptSwitcher / SettingsSheet (commits `7cca8bb`, `efd26c1`, `d55fb6b`, `1767eb1`, regression test `aae1684`).

### Case 5: Hero verse translation didn't swap with reader-lang

- **Cause:** the homepage hero (`FeaturedVerseHero.astro`) statically rendered the featured verse in English. The `ReaderLangSwap` island that re-renders a verse from `window.__readerData` when the reader-lang changes was mounted only on the verse-route page (`/{tradition}/{slug}/{ch}/{v}.astro`) — not on the homepage. Picking Hindi on the homepage updated the localStorage key but left the hero in English.
- **Fix (two parts):**
  - `00b1d6f` ("feat(hero): inject __readerData with all 12 langs for featured verse") — added the per-lang payload to the homepage hero.
  - `6f9feec` ("refactor(reader): mount ReaderLangSwap in BaseLayout for site-wide swap") — elevated the mount from per-page to `BaseLayout.astro` so any future page surfacing a verse no-ops gracefully if it omits the payload.
- **Lesson:** *elevate the mount, not the logic.* When an island needs to work site-wide, mount it once at the layout level and gate its work on the presence of `window.__readerData`. Pages without the payload get the cheap no-op; pages with it get the swap.

---

## Templates

### A. Per-language translation agent prompt (canonical)

The load-bearing prompt template lives at `pipeline/translate/prompts/v1-sanskrit-grounded.md` (read it; it is the source of truth and is versioned as `prompt_version: v1-sanskrit-grounded`). The judge counterpart is `pipeline/translate/prompts/v1-judge.md` (`prompt_version: v1-judge`).

When dispatching one agent per language, parameterize the template with:

- `{{target_language}}` — the lang code (`hi`, `ta`, `pa`, `or`, …) + native name in parentheses (e.g. `pa (ਪੰਜਾਬੀ)`).
- `{{devanagari}}`, `{{iast}}`, `{{slp1}}` — the canonical Sanskrit verse strings.
- `{{morphology}}` — the Vidyut output for the verse (or `(no morphology data available)` if the morph runner has not yet processed the text).
- `{{lexicon_glosses}}` — the Cologne MW + Apte glosses keyed by lemma.
- `{{meter}}` — the Skrutable meter tag.
- `{{prev_verse_context}}` — the preceding two verses in the same text (for pronoun resolution and register).
- `{{pd_english_reference}}` — any PD English translation (Woodroffe etc.) OR an explicit "no reference available — ground on Sanskrit alone" sentence.

In addition to the template body, append the per-text scope guardrails from Step 9 (forbidden-file list, no `git add -A`, canonical JSON shape pinned by field name) and the output paths (`data/translations/{slug}/{lang}.json` + `data/glosses/{slug}/{lang}.json`). For shared-script langs (mr vs hi, as vs bn), also pin the distinguishing-feature reminder from Step 9.

### B. Per-language audit agent prompt (canonical)

Used by the QA pass-2 audit on 2026-06-01 to catch Marathi-vs-Hindi and Assamese-vs-Bengali drift. Shape:

> You are auditing the per-language JSON files in `data/translations/{slug}/{lang}.json` and `data/glosses/{slug}/{lang}.json` for the `{lang}` ({native_name}) translation of {text_title}.
>
> Run THREE checks and emit a structured report:
>
> 1. **Unicode-block check.** Every translation string and every gloss `gloss_text` value MUST contain at least one code point in the expected Unicode block for {lang}. Expected blocks: `as` U+0980–U+09FF (Bengali block); `bn` U+0980–U+09FF; `gu` U+0A80–U+0AFF; `hi` U+0900–U+097F (Devanāgarī); `kn` U+0C80–U+0CFF; `ml` U+0D00–U+0D7F; `mr` U+0900–U+097F (Devanāgarī); `or` U+0B00–U+0B7F; `pa` U+0A00–U+0A7F (Gurmukhi); `ta` U+0B80–U+0BFF; `te` U+0C00–U+0C7F.
>
> 2. **Distinguishing-feature check** (only for shared-script langs):
>    - `mr` vs `hi`: count occurrences of `च[ायेी]` (Marathi genitive postposition family) — Marathi should have many, Hindi should have few/none. Count `क[ायेी]` (Hindi genitive postposition family) — opposite expectation.
>    - `as` vs `bn`: count `ৰ` (U+09F0) — Assamese-specific. Count `র` (U+09B0) — Bengali-specific.
>
> 3. **`[draft]`-leak check.** Grep every translation string + every `gloss_text` for `[draft]` (case-insensitive). Expected count: 0.
>
> Output: a per-check verdict with counts + 3 sample excerpts. Do NOT fix anything; report only.

### C. Atomic commit message conventions

Conventional Commits, scope after the type. Phase 1 patterns:

- `feat(content): ingest {text} Sanskrit + en translation`
- `feat(corpus): {text} full Sanskrit corpus`
- `feat(i18n): {Native Name} ({code}) translation dictionary` — per-lang
- `feat(i18n): {text} word_glosses` — per-lang gloss file (when split from translation)
- `chore(corpus): YAML normalization for {text}`
- `fix(content): strip [draft] markers from {text}`
- `fix(qa): ISSUE-NNN — short description`
- `test(qa): regression test for ISSUE-NNN — short description`
- `docs(qa): QA report + baseline.json for YYYY-MM-DD sweep`

### D. Pre-launch checklist (for the next text)

- [ ] Source pulled + provenance recorded (URL + revision + accessed-on date in YAML)
- [ ] License audited; `ATTRIBUTION.md` updated; `pending_miri: true` flagged if applicable
- [ ] YAML authored at `data/corpus/{slug}.yaml`; expected verse count verified vs printed edition
- [ ] EN translation generated via `pipeline/translate/runner.ts --lang en --text {slug}` (judge score ≥ 7 to publish)
- [ ] Morph pass produced English glosses + morph fields (or substituted by the translator agent until `pipeline/morph/` lands)
- [ ] 11 Indic langs dispatched in parallel, each landed as atomic per-lang commit (see Template C)
- [ ] Per-lang audit agent run (Template B) — Unicode block + distinguishing-feature + `[draft]`-leak all green
- [ ] Slug aliases added to `src/lib/aliases.ts` if the romanization has variants
- [ ] `bun ingest` ran clean; row counts match expected (1 text / N verses / N×12 translations / N×W×12 glosses)
- [ ] No `[draft]` markers: `bun run test tests/unit/no-draft-marker-leak.test.ts` passes
- [ ] Full gate sweep green: `bun typecheck && bun run test && bun e2e`
- [ ] Cross-lang matrix probe passes (sample 5 verses × 12 langs via `getVerseAllLanguages`)
- [ ] Homepage curation updated if the text deserves headline placement
- [ ] Tag release (`vYYYY.MM.DD`); Zenodo deposit confirmed (or held if Muktabodha + MIRI pending)
- [ ] Ambuda upstream PR opened (skip if AI-only translations + Ambuda policy excludes)

---

## Future improvements (parking)

- **Auto-generated `expected_verse_count` validation** at ingest time — read from YAML top-level, assert against post-ingest `COUNT(*) FROM verses WHERE text_id = ?`.
- **CI-gated lint** that runs `tests/unit/no-draft-marker-leak.test.ts` on every PR (today it lives in the local `bun run test` gate).
- **`pipeline/sources/` directory** with per-source fetchers (GRETIL, Muktabodha, sanskritdocuments, SARIT, Wikisource) standardizing the "pull + record provenance" pattern. Today this is ad-hoc per text.
- **`pipeline/translate/dispatch.ts` orchestrator** that fans out the 11 per-lang agents from a single command. Today the fan-out is done manually via parallel agent dispatch (Step 9).
- **`pipeline/morph/` implementation** (workstream 2). Today the morph + English-gloss output is produced inline by the translator agent rather than by an automated Vidyut + Cologne MW pipeline.
- **`pending_miri` gate in `pipeline/dataset/publish.ts`** — today this is enforced manually before tagging.
- **Per-text `editorial_policy.md`** documenting cited edition + emendation policy + variant handling (Codex deferred item G).
- **Schema-fit for non-verse-shaped texts** — nullable `section_type` + `prose_block_ref` columns (Codex deferred item H).

---

## When this runbook needs updating

- After every new text shipped — add a new "Case N" if a new failure mode surfaced.
- When a new schema field is added — update Step 5.
- When licensing posture changes (e.g. MIRI letter arrives) — update Step 3 + Step 12 + `ATTRIBUTION.md`.
- When the agent prompt template evolves — bump `prompt_version` and update Templates A/B; do NOT edit existing prompt files in place after the first published run (per `pipeline/translate/README.md` §"Prompt versioning").
- When the pre-launch checklist gets a new item — update Template D.
- When a new automated lint lands — wire it into Step 10.
