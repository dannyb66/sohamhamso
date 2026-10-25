# sohamhamso

[![DOI](https://img.shields.io/badge/DOI-pending-lightgrey.svg)](#citation)
[![Code license: MIT](https://img.shields.io/badge/code-MIT-blue.svg)](./LICENSE)
[![Content license: CC BY-SA 4.0](https://img.shields.io/badge/content-CC--BY--SA%204.0-orange.svg)](./LICENSE)

`so'haṃ haṃsaḥ` — the ajapa-japa breath mantra: *haṃ* on the outbreath, *sa* on the in. Read forward and backward, it mirrors itself, a palindrome that doubles as the Pratyabhijñā motif of *pratibimba* (reflection).

Sohamhamso connects a mobile-first reader for the Tantric / Kashmir Shaivism / Trika / Kaula corpus with AI-assisted video-generation tooling for the [SOHAM HAMSO channel](https://www.youtube.com/@sohamhamso). The reader presents Sanskrit, transliteration, word-by-word glosses and translations in English plus eleven Indic languages. Both outputs share corpus addresses, translations and provenance; publishing interfaces turn that data into web pages, dataset bundles, narration and compositions.

The project is donation-funded and non-profit. Its editorial design treats auto-commentaries as sibling texts rather than commentary glued under a verse; current source extraction is described per text and should not be mistaken for a complete commentary corpus.

The broader documentation inventory was verified on **2026-10-12 at `4c94bf2`**; website runtime instructions were updated for the **2026-10-25 static corpus release**. The [capability matrix](docs/CAPABILITY-MATRIX.md) distinguishes release code, historical branches and live verification. The [engineering case study](docs/STAFF-PRINCIPAL-POSITIONING.md) explains architectural judgment and its evidence.

## Table of contents

- [Engineering overview](#engineering-overview)
- [Currently online](#currently-online)
- [The corpus](#the-corpus)
- [Run locally](#run-locally)
- [Architecture](#architecture)
- [AI systems](#ai-systems)
- [AI-assisted video generation](#ai-assisted-video-generation)
- [Engineering decisions](#engineering-decisions)
- [Dataset](#dataset)
- [Contributing](#contributing)
- [License](#license)
- [Citation](#citation)
- [Acknowledgements](#acknowledgements)
- [Documentation navigation](#documentation-navigation)
- [Links](#links)

## Engineering overview

The central platform contract is a multilingual corpus document with stable text/chapter/unit identity, original Sanskrit, source/license metadata, glosses and translation provenance. Zod validation and transactional ingestion build a reproducible SQLite database. Astro consumes it for build-time pages; the build also exports static chapter, lemma and search assets for request-time verse/search delivery. Translation, dataset and video tools reuse the corpus outside the request runtime.

Media generation combines speech synthesis and template-based Remotion/FFmpeg composition, with SQL lifecycle state, event history, leases, QA and publishing tools. This is AI-assisted media automation; no text-to-video model integration is established. [Architecture](docs/ARCHITECTURE.md) maps runtimes and responsibilities; [operations](docs/OPERATIONS-AND-QUALITY.md) explains how to verify and recover them.

## Currently online

Read-only probes on **2026-10-12** returned HTTP 200 and expected page titles for the homepage, English/Hindi Śiva Sūtras 1.1, search, methodology, privacy, sources and dataset pages. These observations establish reachable surfaces, not the deployed commit, database implementation, email delivery or media pipeline origin. See the [verification report](docs/VERIFICATION-2026-10-12.md).

| Surface | Path | Behavior and status |
|---|---|---|
| Homepage | `/`, `/hi` and other locale prefixes | Corpus index and daily spotlight; homepage checked live |
| Reader | `/{tradition}/{text}/{chapter}/{verse}` | Example: [`/trika/siva-sutras/1/1`](https://sohamhamso.org/trika/siva-sutras/1/1); Sanskrit, IAST, glosses, translation |
| Localized reader | `/{lang}/{tradition}/{text}/{chapter}/{verse}` | Example: [`/hi/trika/siva-sutras/1/1`](https://sohamhamso.org/hi/trika/siva-sutras/1/1); Hindi locale checked live |
| Search | `/search`, `/api/search` | Static lexical index; semantic/blended requests explicitly fall back to lexical results |
| Texts index | `/texts`, localized equivalents | Counts from ingested corpus; configured route |
| Subscribe | Homepage band and `/api/subscribe` | Opt-in/token persistence configured; accepted form does not establish confirmation/daily mail delivery |
| Methodology | `/about/methodology` | Translation/editorial policy; checked live |
| Privacy | `/about/privacy` | Subscriber policy; checked live; inspect code-specific gaps in security guide |
| Attribution | `/about/sources` | Current source page; `/about/attribution` was a stale README route |
| Dataset | `/dataset` | Format/citation landing page checked live; DOI and published deposit remain unverified |
| PDF library | `/library` | Branch-only implementation; live probe returned 404 |

English is unprefixed. Configured locales are `en hi ta te bn mr gu kn ml pa or as`; scripts and transliteration modes are distinct from translation languages. Verse pages use on-demand SSR. Most informational/index pages are generated during the build. See [delivery reference](docs/WEB-DELIVERY-AND-EDGE.md).

## The corpus

A fresh ingest at the baseline reconstructed **11 texts, 76 chapters, 3,023 addressed units: 2,275 verse/sūtra units and 748 prose blocks**. It generated 256,453 language-specific gloss rows and 36,276 translation rows: 3,023 per locale. Counts measure stored content, not editorial quality.

| Text / canonical slug | Units | Primary source recorded in corpus | Publication caveat |
|---|---:|---|---|
| Śiva Sūtras / `siva-sutras` | 77 | GRETIL, Oliver Hellwig transcription | Per-file CC BY 4.0 |
| Spanda Kārikās / `spanda-karikas` | 52 | Muktabodha in YAML | YAML says PD; no automated MIRI hold set, so verify source permission separately |
| Pratyabhijñāhṛdayam / `pratyabhijna-hrdayam` | 20 | Muktabodha | Automated dataset hold |
| Vijñāna Bhairava Tantra / `vijnana-bhairava-tantra` | 163 | Muktabodha, GRETIL verification | Automated dataset hold |
| Karpūrādi Stotra / `karpuradi-stotra` | 22 | sanskritdocuments.org | YAML license label does not settle upstream permission |
| Gītārthasaṃgraha / `gitartha-samgraha` | 716 | Muktabodha, Gītā mūla extraction | Automated dataset hold; commentary prose excluded |
| Īśvarapratyabhijñākārikā / `isvarapratyabhijna-karika` | 190 | GRETIL | CC BY-NC-SA 4.0; vṛtti excluded |
| Mahānirvāṇa Tantra / `mahanirvana-tantra` | 279 | Muktabodha/Wikisource | Automated dataset hold; current selection, not complete text |
| Parātrīśikā / `paratrisika` | 36 | GRETIL | CC BY-NC-SA 4.0 |
| Śivadṛṣṭi / `sivadrsti` | 720 | Muktabodha | Automated dataset hold |
| Tantrasāra / `tantrasara` | 748 prose blocks | GRETIL; existing hold metadata | Automated dataset hold; prose is not metrical verse |

All translation rows declare `published`; none record a human reviewer. 36,019 carry the AI flag, and 2,689 retain a judge score. Publication status therefore cannot substantiate a judge pass for every row or human review. AI provenance remains attached after review. Read [STATUS-CONTRACT.md](STATUS-CONTRACT.md), [AI evaluation](docs/AI-SYSTEMS-AND-EVALUATION.md) and the [data reference](docs/CORPUS-AND-DATA-PLATFORM.md) for exact field behavior and coverage.

Source terms vary, including non-commercial and permission-pending material. Dataset export automatically excludes six flagged texts, but that filter does not establish permission for every remaining text. [ATTRIBUTION.md](ATTRIBUTION.md) preserves source credits; [security and licenses](docs/SECURITY-PROVENANCE-AND-LICENSES.md) explains the responsibilities.

## Run locally

The verified walkthrough used **Bun 1.3.14**. CI installs latest; the historical contributor minimum is Bun 1.1. No production credentials or generation APIs are needed to read ingested content.

```sh
git clone https://github.com/dannyb66/sohamhamso.git
cd sohamhamso
bun install --frozen-lockfile
bun run db:build
bun run dev
```

Open `http://localhost:4321/trika/siva-sutras/1/1`. `db:build` reconstructs the ignored SQLite cache. `dev` runs `db:ensure` and exports static corpus assets before starting Astro. `db:ensure` checks only whether the database exists, so re-run ingestion and restart `dev` after corpus edits. Avoid `--force` on a database containing operator state. Follow the [reader tutorial](docs/tutorials/LOCAL-READER.md) for locale examples and troubleshooting.

Credentials-free checks:

```sh
bun -e 'import {parseTextYaml} from "./pipeline/ingest/ingest.ts"; console.log(parseTextYaml("data/corpus/siva-sutras.yaml").id)'
bun run typecheck
bun run test
MOCK_ALL=true bun run youtube:validate-config
bun pipeline/translate/runner.ts --lang en --text siva-sutras --dry-run --limit 1
```

Use `bun run test` to select Vitest; bare `bun test` selects Bun's native runner. Already translated content yields zero eligible translation rows. [AI docs](docs/AI-SYSTEMS-AND-EVALUATION.md) show an isolated fixture that exercises prompt construction. Browser tests need Playwright Chromium and use `bun run e2e`.

Optional live translation requires `ANTHROPIC_API_KEY`; embeddings use `OPENAI_API_KEY`. Media rendering needs native browser/FFmpeg tooling, while TTS, R2 and YouTube publishing need their service credentials. Live commands incur API costs or external writes and are identified in the [video guide](docs/AI-VIDEO-AND-YOUTUBE-PLATFORM.md). [`.env.example`](.env.example) covers baseline environment settings; the reader does not require copying it. Node/Docker instructions are uncommitted development work and unavailable in this baseline.

## Architecture

### Database policy — no Turso

Do not add Turso, libSQL clients, remote corpus credentials, seed jobs or backup
workflows. Local ingestion and media jobs use SQLite; production subscriptions
use the `PII_DB` Cloudflare D1 binding. Texts, translations, glosses and lexical
search indexes are exported into the site at build time. Reading a text must
never require a runtime database connection.

Production search is lexical only. Optional local embedding tools do not enable
semantic website search. Confirmation email is sent by the existing subscription
handler; this cleanup does not change daily-email scheduling or YouTube jobs.

The optional weekly demand report reads aggregate counts from D1 using a D1 Read
token. Its configuration and legacy data-retention instructions are documented in
[the database operations runbook](docs/D1-CUTOVER.md).

`bun run build` and `bun run seo:build` export chapter bundles and search indexes into `dist/_data/corpus/` and verify their counts against SQLite. Deploy the generated assets together with the Worker. Verse pages still assemble HTML on request from those immutable assets; they do not query a database. A successful deployment must serve `/_data/corpus/manifest.json`, pass `/api/health/corpus`, and render both English and localized verse URLs. A working homepage alone does not verify the reader.

Astro 5 uses `output: 'static'`, a Cloudflare adapter, and explicit `prerender = false` on verse/search/API routes. It does not use the removed `hybrid` config value or pre-render every verse. Solid.js hydrates small islands for settings, script selection, search and translation inspection. Native processing runs under Bun/Python on build/operator hosts.

```text
Translation/gloss shards → merge into corpus YAML
                 |
         validate + ingest -> SQLite
          /          |           \
Astro build      AI tooling    dataset export
    |                |         CSV/JSON/TEI
Pages static + SSR   TTS/composition/render
    |                |          |
Static corpus assets QA + SQL state + R2
                              |
                         upload/analytics
```

Local SQLite combines logical tables for convenience. Public corpus reads use static chapter bundles and search indexes; subscription, confirmation, and unsubscribe requests use the `PII_DB` D1 binding. Media uses distinct corpus/state DB paths in scheduled workflows. No remote corpus adapter or libSQL dependency is retained. See [the deployment runbook](docs/D1-CUTOVER.md). The separately deployed D1 daily-email Worker is unchanged by this cleanup; Node/Docker work is not included.

## AI systems

The translation runner constructs Sanskrit-grounded prompts from verse text, existing database glosses and nearby context, then asks a model to generate and judge the result. Versioned prompts and translation metadata support inspection; bounded fan-out and transient retries coordinate language jobs. The separate deterministic Vidyut morphology runner produces audit artifacts, but its output is not automatically consumed by translation generation.

The checked-in translations include Opus labels, while the current runner's logical Sonnet label and provider API model identifier differ. Most rows have no retained judge score. A judge shares model/grounding failure modes with the generator, and an AI score is not a human review. Embedding/search implementations exist with lexical fallback, process-local caching and an in-memory similarity scan; verified vector coverage, retrieval-quality benchmarks and an autonomous agent/RAG answer pipeline are not established. See [AI systems and evaluation](docs/AI-SYSTEMS-AND-EVALUATION.md).

## AI-assisted video generation

The intended operator flow is:

`Corpus/translations → manifest → TTS or source audio → composition/subtitles → rendering → media QA → storage → upload → analytics`

In the merged implementation, SQL job rows, version hashes, render sidecars and composition props carry the selected content and state. TTS narration uses Google Cloud; Remotion lays out text and audio, and FFmpeg handles media processing. Shorts and full-chapter compositions have different timing and translation floors. QA checks technical constraints, not scholarly correctness. The actual Shorts engine writes the R2 object before its QA step; failed output is not made upload-eligible. The reference documents this ordering and recovery limits.

The baseline chapter configuration is English-only with chapter uploads disabled; the Shorts upload workflow is manual-only because its schedule is held. Language-channel routing and Azure voices are on branch `8aa582f`. Source-audio/ASS and parallel Rudri ASR/OCR/FFmpeg workflows are uncommitted. Background PNG files alone do not establish AI visual-generation provenance, and no repository-integrated text-to-video model is evidenced.

Representative public channel outputs, verified in its listing on 2026-10-12:

- [Tripura Rahasya, Chapter 1, English audio](https://www.youtube.com/watch?v=BpMYhZOb5VE)
- [Shiva Shadakshara Stotram with English meanings](https://www.youtube.com/watch?v=fuo18Q8Y9gA)

These illustrate channel output style. No committed manifest/state record ties those IDs to a particular pipeline. See [video platform](docs/AI-VIDEO-AND-YOUTUBE-PLATFORM.md), [CLI handbook](scripts/youtube/README.md) and [prototype evolution](docs/EVOLUTION-FROM-PROTOTYPE.md) for detailed execution, failure handling and status.

## Engineering decisions

Four [decision records](docs/README.md#decision-records) explain evidenced tradeoffs: static indexes versus SSR verses, native/edge and corpus/PII database boundaries, permanent translation provenance, and durable media lifecycle/recovery. These are dated reconstructions grounded in source/history, not claims of a contemporaneous formal ADR process. Each names the remaining limitations and links implementation/tests.

## Dataset

Implemented tooling exports five CSV tables (`texts`, `verses`, `translations`, `word_glosses`, `parallels`), one denormalized JSON shard and minimal TEI-XML document per eligible text, attribution/license metadata and `checksums.sha256`. Versions follow `vYYYY.MM.DD`. A verified local export excluded six held texts and produced 5 texts, 377 units and 4,524 translations.

```sh
bun pipeline/dataset/publish.ts --version v2026.10.12 --out /tmp/sohamhamso-dataset
cd /tmp/sohamhamso-dataset/sohamhamso-dataset-v2026.10.12
shasum -a 256 -c checksums.sha256
```

This reads the database in read-only mode and creates local bundle files; it neither changes database bookkeeping nor deposits to Zenodo. The [dataset runbook](pipeline/dataset/README.md) covers safe deposit planning and explicit live `--execute`, plus the checksum boundary when a deposit provenance file is added later.

Example schema: `texts.csv` includes `id, slug, title_sa, title_en`; `verses.csv` joins through `text_id` and has `chapter, verse_num, devanagari`; translations join through `verse_id` and include language/status/provenance. Publisher column lists are the export contract, not every database column. The export currently omits prose markers and some newer metadata; see [data reference](docs/CORPUS-AND-DATA-PLATFORM.md).

Load a generated bundle in pandas (optional Python/pandas installation):

```python
import pandas as pd
texts = pd.read_csv("texts.csv")
verses = pd.read_csv("verses.csv")
translations = pd.read_csv("translations.csv")
siva_id = texts.loc[texts.slug == "siva-sutras", "id"].iloc[0]
print(verses[verses.text_id == siva_id].head())
```

**Zenodo/DOI status:** first public deposit remains unverified; no GitHub releases or local tags were found during inspection. The `/dataset` page's publication wording is not proof of a release. Do not cite placeholder DOIs. Export permission holds do not settle upstream license conflicts, so publication needs source-by-source clearance.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) and the [documentation index](docs/README.md). Common entry points:

- **Translation corrections:** use the [Translation issue template](.github/ISSUE_TEMPLATE/translation-issue.md), include the verse URL, language, proposed correction and Sanskrit/lexical grounds. Retain AI provenance when adding reviewer attribution.
- **Corpus sources:** follow [ingestion](docs/INGESTION.md), preserve source revision, transcription credits, license and permission status; validate before writing rows.
- **Web/code:** use schema and edge adapters as boundaries, add meaningful regressions for changed behavior, and check localization/accessibility/SEO where relevant.
- **Media templates:** inspect [video platform](docs/AI-VIDEO-AND-YOUTUBE-PLATFORM.md), update versioning when output changes, exercise mocks and then validate actual fonts/audio in a local render before live publication.
- **Operations/docs:** keep commands and capability status aligned with the chosen baseline; link one authoritative reference per topic and record verification limits.

Reviewers must write corrections from Sanskrit and must not paste copyrighted scholarly translations. Consultation citations and source permissions remain part of provenance. Code, data and translation changes need different kinds of review; a passing test cannot authorize content reuse.

## License

Dual-licensed. **Code** (`src/`, `pipeline/`, `scripts/`, `tests/`, `db/schema.sql`, configuration) is **MIT**. The project's **content** terms (`data/corpus/`, generated dataset outputs, translations, glosses and prose documentation) are **CC BY-SA 4.0**, subject to upstream terms. [NOTICE](NOTICE) maps directories and [LICENSE](LICENSE) contains full texts.

Specific source files may carry additional or alternative restrictions, including NC and scholarly-use/permission terms. The project license cannot grant rights it does not own; inspect [ATTRIBUTION.md](ATTRIBUTION.md) before redistribution. Audio recordings, performers, images and fonts have separate rights and credits; public availability, an AI-generated label or source-audio attestation is not proof of ownership. See [security/provenance/licenses](docs/SECURITY-PROVENANCE-AND-LICENSES.md).

## Citation

Until a real versioned DOI is confirmed, cite the repository and the exact commit used:

```bibtex
@misc{sohamhamso_4c94bf2,
  title        = {sohamhamso: Multilingual Sanskrit reader and AI-assisted media tooling},
  author       = {{sohamhamso contributors}},
  year         = {2026},
  howpublished = {\url{https://github.com/dannyb66/sohamhamso}},
  note         = {Commit 4c94bf26b9e85747a22ed8ea271995a6b3828720; accessed 2026-10-12}
}
```

For data reuse, additionally cite the source text/edition, bundle version and checksum manifest. **Pending DOI:** replace this repository citation with actual Zenodo version metadata only after a published deposit resolves. `10.5281/zenodo.TBD` is not a usable citation. The permission request and per-text holds are described in [attribution](ATTRIBUTION.md).

## Acknowledgements

- **Muktabodha Indological Research Institute (MIRI)**: digitized Sanskrit editions recorded in the corpus. Written redistribution permission is recorded as pending; applicable holds are preserved.
- **GRETIL** (Göttingen Register of Electronic Texts in Indian Languages): machine-readable source editions and transcription credits. Licenses are per-file, including CC BY-NC-SA; availability is not blanket permission.
- **sanskritdocuments.org**: community source transcription, including Karpūrādi Stotra; retain volunteer credit and applicable permission terms.
- **Cologne Digital Sanskrit Dictionaries / C-SALT**: lexical resources referenced by the grounding methodology. Runtime prompts use stored glosses; a verified live dictionary lookup is not guaranteed for every generated gloss.
- **Vidyut** (vidyut-cheda / vidyut-prakriya): deterministic Sanskrit analysis tooling used by the separate morphology workflow.
- **Ambuda**: open-source Sanskrit reading and analysis ecosystem, including Vidyut. No formal corpus-sharing partnership is established here.
- **The Lakshman Joo lineage**: the living transmission that informs the project's editorial context. This project does not speak for any lineage.
- **Astro, Solid, Sanscript, Zod, Bun, SQLite, Remotion and FFmpeg contributors**: implementation dependencies and rendering tools visible in [package.json](package.json) and pipeline source; dependency acknowledgements are not an endorsement or license replacement.

## Documentation navigation

Use [docs/README.md](docs/README.md) for role-based reading paths. The [local tutorial](docs/tutorials/LOCAL-READER.md) is the contributor starting point; [architecture](docs/ARCHITECTURE.md), [data](docs/CORPUS-AND-DATA-PLATFORM.md), [AI](docs/AI-SYSTEMS-AND-EVALUATION.md), [media](docs/AI-VIDEO-AND-YOUTUBE-PLATFORM.md), [web](docs/WEB-DELIVERY-AND-EDGE.md), [operations](docs/OPERATIONS-AND-QUALITY.md) and [security](docs/SECURITY-PROVENANCE-AND-LICENSES.md) provide implementation depth.

For engineering review, read [evolution](docs/EVOLUTION-FROM-PROTOTYPE.md), [capability status](docs/CAPABILITY-MATRIX.md) and [verification](docs/VERIFICATION-2026-10-12.md). The [career package](docs/STAFF-PRINCIPAL-POSITIONING.md) and [dated keyword matrix](docs/ATS-KEYWORDS-AND-CAREER-USAGE.md) map claims to evidence without inferring organizational leadership from project complexity.

## Links

- [Live site](https://sohamhamso.org)
- [Current repository](https://github.com/dannyb66/sohamhamso)
- [SOHAM HAMSO channel](https://www.youtube.com/@sohamhamso)
- [Live methodology](https://sohamhamso.org/about/methodology)
- [Documentation index](docs/README.md)
- [Engineering case study](docs/STAFF-PRINCIPAL-POSITIONING.md)
- [Per-source attribution](ATTRIBUTION.md)
- [Translation status contract](STATUS-CONTRACT.md)
- [Historical prototype](https://github.com/dannyb66/soham-hamso)
