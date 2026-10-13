# Documentation verification — 2026-10-12

This report covers documentation built in an isolated worktree from verified `origin/main` **`4c94bf26b9e85747a22ed8ea271995a6b3828720`**. Existing worktrees and the older prototype were read as evidence, without switching, merging or cleaning them. Implementation, API, schema and type files are unchanged.

## Completed checks

| Check | Observed result |
|---|---|
| Baseline identity | Fetch, local ref and remote `ls-remote` agreed on main commit |
| README preservation | All 10 original sections retained; each expanded; TOC and technical reading paths added |
| Dependencies and types | `bun install --frozen-lockfile` and `bun run typecheck` passed using Bun 1.3.14 |
| Fresh corpus reconstruction | `bun run db:build`: 11 texts, 76 chapters, 3,023 units (2,275 verse/sūtra + 748 prose), 256,453 gloss rows and 36,276 translations |
| Pure YAML validation | Exported `parseTextYaml` printed `siva-sutras`, without DB writes; replaced unsupported ingest dry-run examples |
| Local reader walkthrough | Homepage, English/Hindi Śiva Sūtras 1.1, search and lexical search API returned 200 on port 4327; verse HTML contained Sanskrit |
| Translation safe walkthrough | Disposable fixture DB, one pending Tamil unit: prompt construction exercised, zero API calls/translation writes, zero failures |
| Focused unit checks | 201 distinct tests across 17 suites passed; overlap between two runs counted once |
| Media integration | `MOCK_ALL=true bun run youtube:integration`: 5 tests across 2 isolated suites passed |
| Media dry-runs | Config validation and isolated short backfill, chapter backfill and sample-plan commands passed |
| Actual local media | Silent one-verse chapter rendered with Remotion/Chromium; measured H.264/AAC, 24.06 seconds and −Infinity LUFS; no TTS, R2 or upload |
| Dataset export | 5 texts, 377 units, 4,524 translations, 41,468 gloss rows; six source holds excluded; all 19 hashed bundle files passed SHA-256 verification |
| Zenodo rehearsal | Dry-run returned `published:false`, null DOI, no HTTP calls; wrote local deposit provenance only |
| Diagrams | All 3 Mermaid diagrams rendered with Mermaid 11.12.2 in installed Playwright Chromium; combined screenshot visually inspected; ASCII diagrams remain readable code blocks |
| Public artifacts | English/Hindi reader and informational routes returned 200; channel listing and two representative video URLs were reachable; `/library` returned 404 |

The dataset build and dry-run outputs are local rehearsal artifacts, not a public release. Its deposit provenance file is added after the checksum manifest and is not covered by that original manifest. No tags or GitHub releases were found. The current reader's deployed commit/backend and every live corpus row were not independently established.

## Test scope and reproducibility

Corpus/AI run: `ingest`, `ingest-reconcile`, `migrations`, `schema-gen-freshness`, `translate-dispatch`, `translate-merge-indic`, `dataset-publish`, `dataset-publish-miri`, `search`, `search.regression-1`, `search-edge-compat.regression-1`, `ai-assisted-badge`, and `morph-compare`, under `tests/unit/` (149 tests).

Additional run: `verse-ssr-edge-compat`, `search-edge-compat.regression-1`, `api-subscribe`, `seo-validate`, and `lemma-index`, under `tests/unit/` (58 tests, with 6 already counted above). Media integration uses `tests/integration/youtube/{chapter-render-flow,render-flow}.test.ts`. These are targeted baseline checks, not a claim that the full Vitest or browser suite was executed.

Follow the [reader tutorial](tutorials/LOCAL-READER.md), [AI fixture walkthrough](AI-SYSTEMS-AND-EVALUATION.md#orchestration-failure-handling-and-operating-examples), [video examples](AI-VIDEO-AND-YOUTUBE-PLATFORM.md), and [dataset runbook](../pipeline/dataset/README.md) for exact operating commands. All live generation, upload, email, remote migration and deployment paths are identified separately from local/dry-run work.

## Link verification and evidence limits

Local Markdown file targets and heading fragments were checked across the changed documentation with a temporary Python script; final counts and build results are recorded below. External checks cover Markdown targets plus bare HTTP references outside code blocks. Public source URLs and employer pages were checked read-only. Direct requests to OpenAI careers returned 403 and sanskritdocuments.org returned 406; both were readable with the web tool. The Unicode Wikisource URL was also confirmed through the web tool. Local onboarding URLs were verified at port 4327 rather than the default 4321 used in examples.

Two prototype commit URLs returned 404: local `f4777a5` is ahead of remote main `db8482a`. Those links were removed and the evolution doc now labels the comparison as local-object evidence. PDF books have no confirmed public commit/download evidence, and language routing is branch-only. Public video IDs are linked as channel outputs without assigning them to an unverified pipeline.

The employer sample in [career usage](ATS-KEYWORDS-AND-CAREER-USAGE.md) was refreshed from OpenAI, Anthropic and Redpanda employer sources; Redpanda's current description was obtained through its public Ashby API. An indexed Nextdata role absent from the current API was excluded from the active sample.

## Remaining baseline limitations

Most published translations lack retained judge scores; none have reviewer metadata. Generator/judge model labeling differs from the provider API identifier. Search's embedding path has no verified vector coverage or calibrated retrieval benchmark. Subscriber persistence does not establish an end-to-end mail handoff. Media mocks do not create genuine production MP4s; lease/retry controls do not make external upload and SQL commit atomic. Source permission flags do not establish export license clearance.

No paid model/TTS calls, YouTube uploads, emails, remote migrations or production deployments were executed. No dependency was added for documentation validation; Mermaid was loaded into the installed browser only for rendering checks. Performance, cost, SLO and audience improvements remain unmeasured. See the [capability matrix](CAPABILITY-MATRIX.md) for exact branch/uncommitted status and [architecture](ARCHITECTURE.md) for tradeoffs.

## Final documentation checks

All **602** Markdown references across **32** changed/new documentation files passed local file and heading checks. All original README sections were retained and expanded. External scanning covered 43 HTTP references including 3 local URLs: 37 direct requests succeeded, two provider-blocked pages and the Unicode source URL were confirmed with the web tool, and the 3 local examples were tested on port 4327. Fingerprints for **308 dirty files in 10 existing worktrees** were unchanged; the prototype was read-only.

The optional full `bun run seo:build` generated 3,023 OG JSON files and compiled server/client bundles, then was stopped during the existing thousands-of-lemma-pages prerender pass. It did not finish; no full production-build, full-dist SEO validation or final file-count success is claimed. Targeted type/schema/SSR/SEO tests and the local reader walkthrough passed. This limitation concerns baseline build verification, not a runtime change introduced by documentation.

`git diff --check` passed. Delivery is documentation only, in branch `docs/platform-and-career-2026-10-12`, with no remote publication or production mutation.
