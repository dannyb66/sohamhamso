# Staff/Principal AI Platform positioning

This reusable brief presents **project evidence**, not a verified personal employment history. Baseline: **2026-10-12, `origin/main` at `4c94bf2`**. Use first-person wording only for work you personally designed, implemented or operated, and identify collaborators accurately. Branch experiments, production reach and organizational leadership need separate evidence.

## Executive narrative

Sohamhamso is a multilingual data and AI publishing platform with two connected outputs: a Sanskrit scripture reader and AI-assisted video tooling for the SOHAM HAMSO channel. Its central engineering problem is turning heterogeneous source texts and translations into a reusable, inspectable contract while preserving editorial status and source provenance.

The platform combines typed corpus validation, reproducible ingestion, translation generation and judge prompts, runtime-specific data adapters, and media workflows with durable state and recovery tooling. Its architectural interest lies in the boundaries: data can serve a reader without a live generation call, AI provenance survives later review, native rendering is separated from edge requests, and uncertain publishing outcomes remain visible to operators.

This is useful evidence for Staff AI Platform roles emphasizing applied AI infrastructure, data contracts, reliability and developer tooling. For Principal roles, pair it with professional examples of cross-team technical direction, adoption, stakeholder alignment and measurable business outcomes. A complex personal repository alone does not establish Principal-level organizational influence.

## Engineering case study

### Problem and constraints

One source corpus must support scholarly reading, translation correction, dataset reuse and multimedia publication. Sanskrit/Indic text shaping and segmentation make data quality visible in the product. Source terms vary by text. Cloudflare request runtimes cannot execute the same native tooling used to ingest SQLite or render video. External model, speech, object-storage and YouTube services fail independently.

The code therefore needs stable text addresses, transparent AI status, repeatable artifacts and recovery controls. The freshly ingested baseline contains **11 texts, 76 chapters, 3,023 units and 36,276 translations**. These are data-volume facts, not audience or revenue impact. [Corpus reference](CORPUS-AND-DATA-PLATFORM.md) records how the counts were derived.

### Architectural response and evidence

| Judgment | Concrete mechanism | Evidence | Practical limit |
|---|---|---|---|
| Share data across products | Sanskrit/translation/gloss contracts feed reader, export and rendering | [Zod schema](../src/lib/seo/corpus-schema.ts), [ingest](../pipeline/ingest/ingest.ts), [chapter props](../pipeline/youtube/chapter-props.ts) | Export loses some prose metadata; source permissions remain per text |
| Preserve trust context | Permanent AI flag, model/prompt metadata, judge score, reviewer state | [runner](../pipeline/translate/runner.ts), [badge tests](../tests/unit/ai-assisted-badge.test.ts), [decision 003](decisions/003-translation-provenance.md) | API model and display label differ; complete judge calibration is not demonstrated |
| Fit runtime to work | Bun SQLite for build/local; libSQL web for SSR; native tools on worker hosts | [corpus adapter](../src/lib/corpus-db.ts), [SSR edge tests](../tests/unit/verse-ssr-edge-compat.test.ts), [decision 001](decisions/001-static-versus-ssr.md) | Remote DB quota/outage remains an edge dependency |
| Make failure recovery explicit | SQL leases, event history, retries, QA and supersession tools | [render engine](../pipeline/youtube/render-engine.ts), [mock integration](../tests/integration/youtube/render-flow.test.ts), [decision 004](decisions/004-media-lifecycle-recovery.md) | No atomic transaction spans YouTube upload and local state |
| Build reusable contributor tooling | Schema validation, dry-runs, ingestion reconciliation, seeded tests, runbooks | [ingest reconciliation tests](../tests/unit/ingest-reconcile.test.ts), [CLI](../pipeline/youtube/cli.ts), [local tutorial](tutorials/LOCAL-READER.md) | Documentation is evidence of onboarding support, not measured adoption |

### Outcomes that can be stated

The repository implements a reusable corpus platform rather than a single video script. A clean ingest reconstructs its database without production credentials. Translation and media records carry provenance and lifecycle state that can be inspected and tested. The live reader returned English and Hindi verse HTML during the dated read-only checks. Dataset tooling produced a local 5-text bundle after applying permission holds; that is not a Zenodo release.

The [verification report](VERIFICATION-2026-10-12.md) supplies the actual checks and limits. No documented current cost reduction, p95 latency gain, uptime attainment, conversion improvement, subscriber growth or team productivity multiplier is available. Add those claims only after collecting dated measurements with a comparison baseline and an attributable contribution.

## Resume bullets

These are adaptable project bullets. Select two or three relevant to the role; preserve qualification where necessary.

- Built multilingual corpus infrastructure using TypeScript, Bun, SQLite and Zod, serving 11 texts and 3,023 verse/prose units across 12 locales through shared reader and publishing contracts. [Evidence](CORPUS-AND-DATA-PLATFORM.md)
- Implemented Sanskrit-grounded LLM translation workflows with versioned prompts, a fidelity judge, bounded fan-out/retries and traceable AI provenance; separated publication status from human review. [Evidence](AI-SYSTEMS-AND-EVALUATION.md)
- Designed runtime-specific data access for Astro/Cloudflare SSR and native build tooling, with batched verse reads, materialized lemma lookup and edge import regression tests. [Evidence](WEB-DELIVERY-AND-EDGE.md)
- Developed AI-assisted media automation with speech synthesis, Remotion/FFmpeg composition, SQL lifecycle events, lease recovery, QA gates and object-storage-backed publishing workflows. [Evidence](AI-VIDEO-AND-YOUTUBE-PLATFORM.md)
- Created reproducible ingestion, multi-format dataset exports with checksums, mocked media checks and contributor runbooks to make platform behavior reviewable without paid service credentials. [Evidence](OPERATIONS-AND-QUALITY.md)

Do not replace “implemented” with “operated at scale” unless production volume and ownership are known. Say “prototyped” for D1/static assets, Node/Docker and Rudri until those uncommitted changes are reviewed and verified; say “developed on a branch” for language-channel routing and PDF books.

## LinkedIn summary draft

I build applied AI platforms around clear data contracts, traceable model outputs and practical failure recovery. In Sohamhamso, I worked on shared multilingual infrastructure for a Sanskrit reader and AI-assisted media tooling: corpus ingestion, translation evaluation, edge delivery and publishing workflows. The project gives me concrete examples of balancing native processing with edge constraints, making AI provenance visible, and designing tooling that contributors can verify locally. I’m interested in Staff/Principal AI Platform opportunities where reusable infrastructure and operational judgment help teams ship dependable AI products.

Replace “I worked on” with the specific role and contribution you can substantiate. Add a separate professional example of enabling multiple teams if that is part of your experience; do not infer it from the platform design.

## Recruiter pitch

“My project Sohamhamso combines multilingual data infrastructure with LLM translation/evaluation and recoverable media publishing. The interesting part is the shared contract and runtime boundaries: one corpus supports web and video, provenance stays attached to AI content, and native rendering is separate from edge delivery. I can walk through the code, tests and tradeoffs. I’m targeting Staff AI Platform work; for Principal scope, I would also discuss my separate cross-team leadership experience.”

## Interview talking points

| Prompt | Discussion path | Evidence to open |
|---|---|---|
| Why a shared corpus? | Stable addresses, data reuse, source licensing, provenance; contrast duplicated text extraction | [Data platform](CORPUS-AND-DATA-PLATFORM.md) |
| How do you evaluate AI output? | Sanskrit/gloss grounding, judge rubric, threshold, missing scores, correlated generator/judge errors, human calibration | [AI evaluation](AI-SYSTEMS-AND-EVALUATION.md) |
| Why SSR? | File-count pressure, request-time dependency, cache behavior, batched reads, pending static asset alternative | [Delivery decision](decisions/001-static-versus-ssr.md) |
| What happens if a render worker dies? | Lease expiry, failure stage, persisted event history, R2 artifacts, retry eligibility | [Media recovery](decisions/004-media-lifecycle-recovery.md) |
| Can you guarantee exactly-once uploads? | Explain external API/local-commit gap, reconcile remote ID before retry, do not claim a guarantee | [Video platform](AI-VIDEO-AND-YOUTUBE-PLATFORM.md) |
| What did you choose not to build? | No model training, Kubernetes control plane or autonomous agent runtime established; keep complexity proportional to the workload | [Keyword matrix](ATS-KEYWORDS-AND-CAREER-USAGE.md) |
| What would you improve next? | Model-label alignment, evaluation calibration, licensed release clearance, measured reliability, deployment parity | [Capability matrix](CAPABILITY-MATRIX.md) |

For each answer, structure the story as constraint, decision, implementation, evidence and remaining risk. Explain your own contribution and review process. Repository tests show intended behavior; production measurements require separate telemetry.

## Evidence to add before stronger leadership claims

Document which teams adopted a shared interface, the design disagreement you resolved, how you aligned product/security/operators, and what changed after adoption. Record timeframe, baseline, outcome, your role and collaborators. Attach design-review records or public artifacts where permission permits. These are development opportunities in the positioning package, not invented achievements.

Use [ATS keywords and career usage](ATS-KEYWORDS-AND-CAREER-USAGE.md) to adapt this brief to a current employer description. GitHub docs support credibility; concise application materials should contain the role-relevant wording and accomplishments.
