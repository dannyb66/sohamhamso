# ATS keywords and career usage

Market refresh: **2026-10-12**. This is a qualitative sample of employer-hosted descriptions, not a census of hiring demand or a prediction of applicant-tracking-system scores. Project evidence refers to the merged `4c94bf2` baseline unless marked otherwise.

## Employer sample and method

Read current employer descriptions and compare their responsibilities with concrete repository mechanisms. Use exact role titles to preserve context; do not infer requirements from title alone. Links may change as jobs close.

| Employer and role | Themes observed | Retrieval and applicability |
|---|---|---|
| [OpenAI: Software Engineer, ChatGPT Infrastructure](https://openai.com/careers/software-engineer-chatgpt-infrastructure-san-francisco/) (explicitly Senior/Staff) | Shared infrastructure, reliable interfaces, developer workflows, observability, safe changes and performance reasoning | Employer page fetched; strongest connection is contract/runtime/recovery tooling. Large-scale operations and multi-team adoption need separate experience. |
| [Anthropic: Staff+ Research Engineer, RL Data Platform](https://job-boards.greenhouse.io/anthropic/jobs/5404725008) | TypeScript/React, Python, data pipelines, human feedback tooling, end-to-end ownership and data quality | Employer Greenhouse page fetched; corpus/evaluation tooling is relevant, but this project does not demonstrate RLHF training or expert-annotation operations. |
| [Redpanda: Principal Software Engineer, AI Platform](https://jobs.ashbyhq.com/redpanda-data/6413538b-df19-40fc-8a1b-0873013a18a2/) | AI infrastructure proposals, policy/auditability, orchestration, distributed systems, on-call and cross-team technical direction | Confirmed via employer's public Ashby posting API because HTML needs JavaScript. Go/streaming/Kubernetes and strategic customer leadership are not established by this repository. |

A Nextdata Principal AI Platform posting appeared in indexed employer search results, but was absent from the current public job-board API during the refresh. It is excluded from the active sample. No salary comparisons or headcount trends are inferred. Recheck each posting before applying.

The common pattern in this sample is ownership of reusable systems and their failure boundaries. That is an inference from the three descriptions, not evidence that a particular keyword increases interview probability. This project is strongest as applied AI/data/reliability evidence; use professional history for enterprise scale and organizational scope.

## Keyword-to-evidence matrix

**Demonstrated** means an implementation and source/test can be inspected. It does not mean production use is verified. **Partial/experimental** means a limited implementation, an unverified deployment, or work outside the merged baseline. **Development opportunity** means the repository does not establish the capability.

| Keyword or responsibility | Classification | Evidence and accurate wording |
|---|---|---|
| TypeScript / JavaScript | Demonstrated | [Ingest](../pipeline/ingest/ingest.ts), web adapters and video scripts: “TypeScript platform tooling.” |
| Python | Demonstrated | [Morphology](../pipeline/morph/runner.py), merge/backfill utilities: “Python corpus analysis tooling,” not a Python backend service platform. |
| SQL / SQLite / libSQL / data modeling | Demonstrated | [Schema](../db/schema.sql), [migrations](../pipeline/ingest/migrations.ts), [corpus adapter](../src/lib/corpus-db.ts). |
| Data pipelines / schema validation / data quality | Demonstrated | [Zod corpus schema](../src/lib/seo/corpus-schema.ts), [reconciliation tests](../tests/unit/ingest-reconcile.test.ts), export checksums. |
| LLM integration / prompt versioning / provenance | Demonstrated | [Translation runner](../pipeline/translate/runner.ts), [status contract](../STATUS-CONTRACT.md); disclose model-label inconsistency. |
| AI evaluation / LLM-as-judge / groundedness | Demonstrated mechanism; partial validation | [Judge prompt](../pipeline/translate/prompts/v1-judge.md), [AI evaluation](AI-SYSTEMS-AND-EVALUATION.md). No calibrated quality benchmark established. |
| Human-in-the-loop review | Partial/experimental | Reviewer fields and correction workflow exist; current corpus has no reviewer metadata. Avoid claiming staffed review operations. |
| Embeddings / semantic search | Partial/experimental | [Embedding runner](../pipeline/embed/runner.ts), [search](../src/lib/search.ts). API-dependent path with fallback; no corpus vector coverage or retrieval benchmark established. |
| Retrieval-augmented generation (RAG) | Development opportunity | Translation uses structured Sanskrit/gloss context; search does not feed a demonstrated retrieval-to-generation answer pipeline. Do not relabel it RAG. |
| Cloudflare Pages / Workers / edge infrastructure | Demonstrated | [Astro config](../astro.config.mjs), [Wrangler](../wrangler.toml), SSR edge tests; live reader routes were probed. |
| Cloud object storage / R2 / S3-compatible tooling | Demonstrated | [Render engine](../pipeline/youtube/render-engine.ts), R2-backed state workflow. Not evidence of broad AWS infrastructure ownership. |
| Google Cloud TTS / OAuth | Demonstrated | [TTS requests](../pipeline/youtube/tts-request.ts), [secrets](../pipeline/youtube/secrets.ts), upload script; service integrations, not cloud administration at scale. |
| Azure Speech / per-language channels | Partial/experimental | Branch `8aa582f`, outside baseline; [status matrix](CAPABILITY-MATRIX.md). |
| Node deployment / Docker / D1 / static corpus assets | Partial/experimental | Uncommitted work inspected in primary worktree; unavailable in baseline. |
| Workflow orchestration / bounded concurrency / retries | Demonstrated | [Translation dispatch](../pipeline/translate/dispatch.ts), SQL media leases and sweeps. Name GitHub Actions/SQL rather than claiming Airflow or Temporal. |
| Idempotency / recovery / reliability engineering | Demonstrated controls; partial guarantee | Eligibility/versioning, leases, state events, failure tests. External YouTube insert is not atomic with local state. |
| Observability / operational diagnostics | Demonstrated tooling | [Structured log helper](../pipeline/youtube/log.ts), events/status commands, [Cloudflare runbook](CF-OBSERVABILITY-SETUP.md). No established fleet-wide tracing or SLO attainment. |
| CI/CD / regression testing / accessibility checks | Demonstrated | [CI](../.github/workflows/ci.yml), Vitest, Playwright/axe and SEO checks. Separate CI configuration from observed run results. |
| Media automation / Remotion / FFmpeg / speech synthesis | Demonstrated | [Compositions](../youtube/composition/Root.tsx), render engines and QA. AI-assisted composition, not a text-to-video model. |
| Source-audio alignment / ASR / OCR | Partial/experimental | Historical prototype and uncommitted Rudri work; avoid claiming a merged production alignment system. |
| Autonomous agents / MCP / tool-calling platform | Development opportunity | No application-side agent runtime or MCP service established. Coding with AI agents is not the same product capability. |
| Kubernetes / Kafka / Go / GPU inference / model training | Development opportunity | No current implementation evidence. Do not add as project skills to match Redpanda or ML infrastructure roles. |
| Large-scale distributed ML infrastructure | Development opportunity | Service integration and retries are present; throughput, model serving fleets and distributed training are not established. |
| Principal technical strategy / cross-team influence | Needs external experience | Project design docs show judgment; team adoption, mentorship, customer alignment and organization-wide impact need separate records. |

## How to tailor application materials

1. Read the actual job description, including required experience and the system the team owns. Mark responsibilities that you can support with this project or your professional history.
2. Choose two or three accomplishments matching those responsibilities. Use the employer's terminology naturally where it accurately describes the work: “data contracts,” “LLM evaluation,” “workflow orchestration,” or “failure recovery.”
3. Attach a concrete mechanism and outcome. For example: “Implemented TypeScript corpus ingestion and translation provenance for 3,023 multilingual verse/prose units, shared by reader and media workflows.” Link the [case study](STAFF-PRINCIPAL-POSITIONING.md) in a project section.
4. Add a separate professional bullet for cross-team adoption or operational scale if you have it. Do not insert unverified scale/cost numbers into the project bullet.
5. Remove unrelated tool lists. Keep branch experiments explicitly labeled, and distinguish skills from technologies you are still learning.

For an evaluation-heavy role, lead with grounding, prompt/model records and calibration limits. For a platform/reliability role, lead with runtime boundaries, leases, retries and contract tests. For a researcher-facing data role, explain schema quality and contributor feedback; do not claim annotation campaign tooling or RLHF production experience from reviewer fields alone.

## Plain wording examples

| Evidence | Usable wording | Avoid |
|---|---|---|
| SQL lifecycle and Actions schedules | “Built media workflow orchestration with lease recovery and persisted failure stages” | “Built an autonomous multi-agent production platform” |
| Versioned translation and judge prompts | “Implemented LLM translation evaluation with traceable provenance” | “Guaranteed hallucination-free AI through calibrated evaluation” |
| Structured context and lexical/semantic search code | “Grounded translations in Sanskrit and glossary context; implemented search fallbacks” | “Enterprise RAG at scale” |
| Local/edge data adapters and tests | “Separated native build processing from edge-compatible SSR delivery” | “Led global Kubernetes ML infrastructure” |

## Evidence maintenance

Refresh the employer sample when roles change and record the date. Recompute corpus counts after ingestion changes. Keep career claims aligned with the [capability matrix](CAPABILITY-MATRIX.md) and [verification report](VERIFICATION-2026-10-12.md). Add cost/latency/channel metrics only with measurement date, source and attribution. There is no promised ATS score, recruiter response or interview outcome; the goal is accurate, relevant application language supported by inspectable work.
