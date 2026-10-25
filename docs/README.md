# Documentation library

This library describes the merged implementation at `origin/main` commit `4c94bf26b9e85747a22ed8ea271995a6b3828720`, inspected on **2026-10-12**. Sohamhamso shares a multilingual scripture corpus between a web reader, dataset tooling, and AI-assisted media workflows for the [SOHAM HAMSO channel](https://www.youtube.com/@sohamhamso).

Start with the [capability and deployment matrix](CAPABILITY-MATRIX.md). “Merged” means code is in the selected baseline; “tested” means the named verification ran; “deployed” requires separate live evidence. Branch and uncommitted features are documented for context, not as commands available in this checkout.

## Reading paths

| Reader | Start | Continue | Result |
|---|---|---|---|
| New contributor | [Reader tutorial](tutorials/LOCAL-READER.md) | [Corpus runbook](INGESTION.md), [contribution rules](../CONTRIBUTING.md) | Run without credentials, validate a source, propose a correction |
| AI contributor | [AI systems](AI-SYSTEMS-AND-EVALUATION.md) | [Translation pipeline](../pipeline/translate/README.md), [provenance decision](decisions/003-translation-provenance.md) | Understand grounding, evaluation and review limits |
| Media operator | [Video platform](AI-VIDEO-AND-YOUTUBE-PLATFORM.md) | [CLI handbook](../scripts/youtube/README.md), [recovery decision](decisions/004-media-lifecycle-recovery.md) | Inspect state, use mocks, diagnose interrupted work |
| Site operator | [Operations](OPERATIONS-AND-QUALITY.md) | [D1 deployment and retirement](D1-CUTOVER.md), [edge delivery](WEB-DELIVERY-AND-EDGE.md) | Locate configuration, checks, failure handling and recovery |
| Engineering reviewer | [Architecture](ARCHITECTURE.md) | [Evolution](EVOLUTION-FROM-PROTOTYPE.md), [decisions](#decision-records), [verification](VERIFICATION-2026-10-12.md) | Assess boundaries and evidence without assuming scale |
| Recruiter or candidate | [Career brief](STAFF-PRINCIPAL-POSITIONING.md) | [Keywords and application usage](ATS-KEYWORDS-AND-CAREER-USAGE.md) | Reuse concrete project evidence in application materials |

## Tutorials

[Run the local reader](tutorials/LOCAL-READER.md) takes a clean checkout to English and Hindi verse pages without paid APIs or production credentials.

## How-to guides

Use [ingestion](INGESTION.md) for corpus changes, [D1 deployment](D1-CUTOVER.md) for database operation and recovery, [video commands](../scripts/youtube/README.md) for media tasks, [observability setup](CF-OBSERVABILITY-SETUP.md) for Cloudflare measurement, and [Phase 8](../scripts/seo/PHASE8-README.md) for search visibility checks. Live API calls, uploads, email and deployment are operator actions; examples identify these separately from local validation.

## References

- [Corpus and data platform](CORPUS-AND-DATA-PLATFORM.md): YAML, schema, ingestion, morphology, migrations and exports.
- [AI systems and evaluation](AI-SYSTEMS-AND-EVALUATION.md): translation and judge contracts, provenance, embeddings and fallbacks.
- [AI video and YouTube platform](AI-VIDEO-AND-YOUTUBE-PLATFORM.md): composition, timing, QA, lifecycle, publishing and analytics.
- [Web delivery and edge](WEB-DELIVERY-AND-EDGE.md): routes, runtimes, locales, islands and caching.
- [Operations and quality](OPERATIONS-AND-QUALITY.md): CI, credentials, schedules, diagnosis and recovery.
- [Security, provenance and licenses](SECURITY-PROVENANCE-AND-LICENSES.md): subscriber storage, OAuth, source and media restrictions.

## Explanations

[Architecture](ARCHITECTURE.md) explains shared platform boundaries. [Evolution from the prototype](EVOLUTION-FROM-PROTOTYPE.md) compares recorded implementations. [Staff/Principal positioning](STAFF-PRINCIPAL-POSITIONING.md) turns demonstrated engineering decisions into an evidence-backed case study.

## Decision records

These are **reconstructed explanations dated 2026-10-12**, not claims that a formal ADR process ran when the code was written. Each points to contemporaneous code comments or history where available.

1. [Static versus SSR delivery](decisions/001-static-versus-ssr.md)
2. [Database boundaries](decisions/002-database-boundaries.md)
3. [Translation provenance](decisions/003-translation-provenance.md)
4. [Media lifecycle and recovery](decisions/004-media-lifecycle-recovery.md)

## Historical material and maintenance

The [YouTube plan](YOUTUBE-PIPELINE-PLAN.md), [initial QA report](qa-report-v1-initial.md), [test findings](test-findings.md) and [June SEO verification](SEO-VERIFICATION-2026-06-03.md) preserve earlier intent and observations. A proposed behavior or old score there is not current deployment proof. Pipeline-local docs remain entry points and link to the authoritative subsystem explanation.

When code changes, update the relevant reference, this index if navigation changes, and the capability matrix if status changes. Recompute corpus counts from YAML or a freshly ingested database. Record the commit, date, command and limits of verification; do not copy historical cost, latency, channel or impact numbers into present-tense claims.
