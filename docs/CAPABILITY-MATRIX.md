# Capability and deployment matrix

Snapshot date: **2026-10-12**. The documentation worktree was created from `origin/main` after `git fetch origin main`; `git ls-remote origin refs/heads/main` and `git rev-parse origin/main` agreed on **`4c94bf26b9e85747a22ed8ea271995a6b3828720`**. Documentation changes do not merge development branches, change runtime behavior or deploy a new build.

## Status vocabulary

- **Merged:** implementation is in the verified main baseline. This is a code status, not a production assertion.
- **Branch-only:** implementation was inspected in a named commit outside main, even if an older related feature has landed through a squash merge.
- **Uncommitted:** files or edits exist in another worktree and are not available in this baseline. Local filenames are evidence locations, not linked files promised by this checkout.
- **Historical:** previous implementation, measurement or plan retained for explanation.
- **Planned:** described intent without a verified implementation of that capability.

“Configured” means settings/code permit a path; “tested” names an actual local check; “live observed” names a dated read-only probe. No deployed commit identity was independently confirmed. Full verification details are in [the report](VERIFICATION-2026-10-12.md).

## Capability inventory

| Subsystem | Implementation state | Evidence | Test or deployment status |
|---|---|---|---|
| Twelve-locale corpus reader | Merged | [reading modes](../src/lib/reading-modes.ts), [verse aggregate](../src/lib/verse-read.ts) | Local English/Hindi route smoke; live route titles observed |
| 11 texts / 3,023 addressed units | Merged source data | [data reference](CORPUS-AND-DATA-PLATFORM.md), fresh ingest | Local reconstruction; no assertion of every live row |
| Prose support | Merged | [schema](../src/lib/seo/corpus-schema.ts), [prose helper](../src/lib/prose.ts) | 748 Tantrasara blocks, distinct from verse count |
| Static indexes plus request-time verses/search | Merged | [Astro config](../astro.config.mjs), [web reference](WEB-DELIVERY-AND-EDGE.md) | SSR route and import regressions; live pages observed |
| Native SQLite/local and Turso/edge adapters | Merged | [corpus adapter](../src/lib/corpus-db.ts), [subscriber adapter](../src/lib/subscriber-db.ts) | Fresh local setup tested; no current live DB topology proven |
| Materialized lemma index | Merged, main `ed1ed8b` | [index builder](../pipeline/ingest/lemma-index.ts), [lemma reads](../src/lib/db.ts) | 15,133 index rows from fresh ingest; quota reduction not remeasured |
| OG JSON cache | Merged, main `dcc3c85` | [cache build](../scripts/seo-build-og-cache.ts) | Build-generated payload; current live OG image not separately audited |
| Subscriber opt-in/token persistence | Merged | [subscribe](../src/pages/api/subscribe.ts), [security](SECURITY-PROVENANCE-AND-LICENSES.md) | Tests/configuration; no mailbox delivery tested |
| Daily/confirmation email delivery | Partial merged scaffolding | [confirmation sender](../pipeline/email/send-confirmations.ts) | Address lookup/queue handoff gaps; no production email sent |
| Static corpus plus D1 subscriber cutover | Uncommitted primary worktree | Local `scripts/static-corpus-export.ts`, `src/lib/static-corpus-read.ts`, `migrations/`, `docs/D1-CUTOVER.md` | Read-only inspection; no cutover, migration or deploy run |
| Deliverable encrypted subscriber mail and daily Worker | Uncommitted primary worktree | Local `src/lib/subscriber-email.ts`, `workers/daily-verse/`, `docs/EMAIL.md` | Local proposal includes temporary plaintext fallback; not baseline behavior |
| Node standalone / Docker SQLite deployment | Uncommitted primary worktree | Local `astro.config.mjs`, `Dockerfile`, `docker-compose.sqlite.yml`, `src/lib/db-backend.ts` | No Node/container build performed; baseline has Cloudflare adapter only |
| AI translation and judge | Merged | [runner](../pipeline/translate/runner.ts), [prompts](../pipeline/translate/prompts/v1-judge.md) | Isolated Tamil dry-run and tests; no new paid calls |
| Translation fan-out and retries | Merged | [dispatch](../pipeline/translate/dispatch.ts) | Bounded concurrency/retry unit tests |
| Vidyut morphology audit | Merged | [runner](../pipeline/morph/runner.py), [comparison](../pipeline/morph/compare.ts) | Comparison tests; not automatically wired into translation runner |
| Embeddings / semantic blended search | Merged experimental path | [embed](../pipeline/embed/runner.ts), [search](../src/lib/search.ts) | Lexical/search regressions; no vector coverage or retrieval benchmark verified |
| Human reviewer workflow | Partial/planned | [status contract](../STATUS-CONTRACT.md), issue template | No reviewer metadata in selected corpus; review UI/audit program not established |
| Centralized model rate-limit gateway | Planned | Runner/dispatch notes | No merged gateway verified |
| CSV/JSON/TEI dataset export | Merged | [publisher](../pipeline/dataset/publish.ts) | Local 5-text bundle + checksums tested; source holds applied |
| Zenodo publication/DOI | Merged deposit client, publication unverified | [deposit](../pipeline/dataset/zenodo-deposit.ts), dataset page placeholder | Safe dry-run only; GitHub releases empty, no local tags |
| Shorts TTS/render/QA/R2 pipeline | Merged | [render engine](../pipeline/youtube/render-engine.ts), [config](../data/youtube-config.yaml) | Mocked state/control-flow tests; no live TTS or upload |
| Chapter rendering/sidecars | Merged | [chapter engine](../pipeline/youtube/chapter-render-engine.ts) | English-only baseline configuration; real silent one-verse local preview |
| Shorts scheduled upload | Merged workflow, schedule held | [upload workflow](../.github/workflows/youtube-upload.yml), main `4c94bf2` | `workflow_dispatch` remains; no automated schedule asserted |
| Per-language channels / Azure or/as voices | Branch-only `8aa582f` | `feat/youtube-chapter-language-routing`: `pipeline/youtube/config.ts`, `secrets.ts`, `tts-request.ts`, workflow edits | Not main; no channel-token or provider availability verification |
| External source-audio chapters | Uncommitted primary/Rudra worktrees | Local `pipeline/youtube/external-audio-chapter.ts`, `scripts/youtube-render-external-audio.ts` | Source/ASS/probe artifacts inspected; not rerun or uploaded |
| Parallel Rudri ASR/OCR/FFmpeg pipeline | Uncommitted primary worktree | Local `pipeline/rudri/`, `scripts/rudri-generate-manifest.ts`, `scripts/rudri-render-parallel.ts`, `docs/RUDRI-PARALLEL-PIPELINE.md` | Review/resume/parts behavior documented from code; no performance claim |
| AI-generated background visual inputs | Unverified provenance | Uncommitted background PNG filenames/samples | Filenames do not establish generator/model; no visual generation service verified |
| PDF books and `/library` | Branch-only `5b74dac` | `worktree-feat-pdf-books`: `pipeline/books/{assemble,render,publish}.ts`, `src/pages/library.astro`, book tests | Branch manifest is not upload proof; public `/library` returned 404 |
| YouTube analytics / SEO updates | Merged | [analytics sync](../scripts/youtube-analytics-sync.ts), [metadata updates](../scripts/youtube-update-seo.ts) | Configured workflows; no current channel statistics imported |
| Cloudflare/SEO observability | Merged tooling | [observability runbook](CF-OBSERVABILITY-SETUP.md), [Phase 8](../scripts/seo/PHASE8-README.md) | Configuration/tests, not an active Logpush or SLO claim |
| Python audio/transcription/translation prototype | Historical `f4777a5` | [evolution](EVOLUTION-FROM-PROTOTYPE.md) | Commit messages record incomplete behavior; no execution performed |

## Branch inventory

Local and remote names inspected with `git branch -a -vv` and `git for-each-ref`. Old branch tips can differ from main even after related content lands through squash merges. Do not use ancestry alone as feature absence/presence evidence.

| Local branch or branch group | Tip | Relevant observation |
|---|---|---|
| `main` | `4c94bf2` | Matches verified remote main |
| `docs/platform-and-career-2026-10-12` | Initially `4c94bf2` | Isolated docs branch/worktree for this task |
| `feat/phase2-foundations` | `71e496e` | Primary worktree with uncommitted cutover/Node/Rudri edits; remote branch at `232878a` |
| `feat/rudra-parallel-render` | `71e496e` | External-audio uncommitted work |
| `feat/youtube-chapter-language-routing` | `8aa582f` | Matching remote; branch-only routing/voice work |
| `worktree-feat-pdf-books` | `5b74dac` | Local-only book pipeline; no matching remote ref inspected |
| `feat/gtm-reach-youtube-seo`, `feat/youtube-chapter-videos` | `5376a5f` | Chapter/SEO development history; primary features checked against merged code |
| `feat/youtube-pipeline-phase1` | `bee340e` | Remote `1e72324`; earlier Shorts work |
| `fix/youtube-generate-corpus-db` | `6b5387c` | Related fix landed as main `3cda5d1` |
| `feat/seo-indexnow-submitter` | `811dc28` | Remote tracking marked gone; inspect main for actual submit workflow |
| `worktree-fix-corpus-source-citations` | `7027306` | Matching remote; source repair landed as main `71e496e` |
| `worktree-fix-lemma-index-read-quota` | `b017620` | Matching remote; materialized index landed as main `ed1ed8b` |
| `worktree-agent-a775fa7f8310231e5`, `worktree-agent-aa32d1af0ee69d718`, `worktree-agent-afe7465e61f3a8e0e` | `c3f80f8` | Prior test/agent worktrees; preserved |
| Remote-only `origin/feat/seo-cf-observability` | `0cfaae5` | Historical observability branch; current tooling checked on main |

`origin/HEAD` pointed to main. Other inspected remote refs were phase2-foundations, youtube-pipeline-phase1, youtube-chapter-language-routing, corpus-db generation fix, source citation fix, and lemma quota fix. Fetching main verified its current remote identity; other remote refs here are locally recorded refs, not a promise they remain open/active remotely.

## Existing worktrees preserved

Names below are relative to the original repository's `.claude/worktrees/`, except the primary checkout. Dirty counts use `git status --porcelain` at inventory time (directory-level untracked entries counted as one); they can include caches and unrelated work. Fingerprints of individual dirty files were recorded for preservation verification.

| Worktree | Branch | Dirty entries observed |
|---|---|---:|
| Primary `sohamhamso` | phase2-foundations | 133 |
| `agent-a775fa7f8310231e5` | worktree-agent-a775fa7f8310231e5 | 2 |
| `agent-aa32d1af0ee69d718` | seo-indexnow-submitter | 0 |
| `agent-afe7465e61f3a8e0e` | worktree-agent-afe7465e61f3a8e0e | 1 |
| `feat-pdf-books` | worktree-feat-pdf-books | 1 |
| `fix-corpus-source-citations` | worktree-fix-corpus-source-citations | 1 |
| `fix-lemma-index-read-quota` | worktree-fix-lemma-index-read-quota | 1 |
| `gtm-reach-youtube-seo` | gtm-reach-youtube-seo | 31 |
| `rudra-parallel-render` | rudra-parallel-render | 26 |
| `stabilize-youtube-chapters` | youtube-chapter-language-routing | 0 |

The older sibling `soham-hamso` repository had modified `main.py`/`requirements.txt`, deleted tracked transcript/video outputs and a temporary audio file. It was read as historical evidence and left untouched. No existing branch was switched, reset, cleaned or merged.

## Inspecting out-of-baseline evidence

In an existing clone containing the local refs, use read-only commands:

```sh
git show 8aa582f:pipeline/youtube/config.ts
git show worktree-feat-pdf-books:pipeline/books/render.ts
git diff --stat origin/main...worktree-feat-pdf-books
git worktree list --porcelain
```

The local PDF tip has no confirmed remote URL, so this library does not present a GitHub link that might resolve to nothing. Uncommitted files have no immutable commit permalink. Recheck status before converting any experimental claim to merged or deployed. See [evolution](EVOLUTION-FROM-PROTOTYPE.md) for the detailed comparison and [architecture](ARCHITECTURE.md) for baseline boundaries.
