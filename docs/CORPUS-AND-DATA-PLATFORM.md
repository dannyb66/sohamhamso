# Corpus and data platform

This reference and explanation describes the corpus at `origin/main` commit `4c94bf2`, inspected on **2026-10-12**. These are repository measurements, not a census of the live deployment. The reader and video pipeline consume the same addressed Sanskrit units and translation provenance; dataset publication applies additional filters.

## Source inventory and measured coverage

The ingestion set is `data/corpus/*.yaml`, excluding underscore templates and FAQ sidecars. Counts include only actual chapter entries, not planned works, claimed manuscript lengths, or the older prototype.

| YAML text / route slug | Chapters | Verse or sūtra units | Prose blocks | Translation rows | `pending_miri` |
|---|---:|---:|---:|---:|---|
| `gitartha-samgraha` | 18 | 716 | 0 | 8,592 | true |
| `isvarapratyabhijna-karika` | 15 | 190 | 0 | 2,280 | false |
| `karpuradi-stotra` | 1 | 22 | 0 | 264 | false |
| `mahanirvana-tantra` | 3 | 279 | 0 | 3,348 | true |
| `paratrisika` | 1 | 36 | 0 | 432 | false |
| `pratyabhijna-hrdayam` | 1 | 20 | 0 | 240 | true |
| `siva-sutras` | 3 | 77 | 0 | 924 | false |
| `sivadrsti` | 7 | 720 | 0 | 8,640 | true |
| `spanda-karikas` | 4 | 52 | 0 | 624 | false |
| `tantrasara` | 22 | 0 | 748 | 8,976 | true |
| `vijnana-bhairava-tantra` | 1 | 163 | 0 | 1,956 | true |
| **Total** | **76** | **2,275** | **748** | **36,276** | **6 held texts** |

The resulting **3,023 addressed units** each contain one translation in English and in each of eleven Indic languages: Assamese (`as`), Bengali (`bn`), Gujarati (`gu`), Hindi (`hi`), Kannada (`kn`), Malayalam (`ml`), Marathi (`mr`), Odia (`or`), Punjabi (`pa`), Tamil (`ta`), and Telugu (`te`). The database calls all these units `verses`; that storage name does not make Tantrasāra's 748 prose blocks metrical verses. Mahānirvāṇa's three chapters are a partial corpus, not the whole work.

All 36,276 source translation rows declare `published`; none declare `draft` or `reviewed`. There are 36,019 AI-assisted rows and 257 rows without the AI flag. Only 2,689 rows carry a `judge_score`; no row carries a reviewer credit. Coverage therefore means present source content, not human approval or evidence that every translation passed a judge. See [AI systems and evaluation](AI-SYSTEMS-AND-EVALUATION.md).

All units carry gloss entries. Expanding the legacy and multilingual gloss fields through the ingestion rules yields **256,453 word-gloss rows**; 21,476 source gloss entries have a nonempty `morph` field. Morphology labels alone do not establish that a deterministic tool produced them.

To reproduce the basic counts without a database or credentials, after installing project dependencies:

```bash
bun -e 'import {readdirSync,readFileSync} from "node:fs"; import {load} from "js-yaml"; let n={texts:0,chapters:0,verse:0,prose:0,translations:0}; for(const f of readdirSync("data/corpus").filter(f=>/\.ya?ml$/.test(f)&&!f.startsWith("_")&&!/\.faq\.ya?ml$/.test(f))){ const d=load(readFileSync("data/corpus/"+f,"utf8")); n.texts++; n.chapters+=d.chapters.length; for(const c of d.chapters) for(const v of c.verses){n[v.section_type??"verse"]++; n.translations+=(v.translations??[]).length;} } console.log(n);'
```

## Source provenance and licenses

These are the license strings recorded in YAML, not an independent grant of permission. Follow the original source header and [attribution record](../ATTRIBUTION.md); an ancient Sanskrit work's public-domain status does not erase restrictions on a modern transcription or translation.

| Source text | Recorded source license | Provenance file |
|---|---|---|
| Gītārthasaṃgraha | `CC-BY-NC` | [Muktabodha-derived YAML](../data/corpus/gitartha-samgraha.yaml) |
| Īśvarapratyabhijñākārikā | `CC-BY-NC-SA 4.0` | [GRETIL-derived YAML](../data/corpus/isvarapratyabhijna-karika.yaml) |
| Karpūrādi Stotra | `CC-BY-SA` | [Sanskrit Documents-derived YAML](../data/corpus/karpuradi-stotra.yaml) |
| Mahānirvāṇa Tantra | `CC-BY-NC` | [YAML with Wikisource URL and permission hold](../data/corpus/mahanirvana-tantra.yaml) |
| Parātrīśikā | `CC-BY-NC-SA 4.0` | [GRETIL-derived YAML](../data/corpus/paratrisika.yaml) |
| Pratyabhijñā Hṛdayam | `PD` | [Muktabodha-attributed YAML with permission hold](../data/corpus/pratyabhijna-hrdayam.yaml) |
| Śiva Sūtras | `CC-BY 4.0` | [GRETIL-derived YAML](../data/corpus/siva-sutras.yaml) |
| Śivadṛṣṭi | `CC-BY-NC` | [Muktabodha-derived YAML](../data/corpus/sivadrsti.yaml) |
| Spanda Kārikās | `PD` | [Muktabodha-attributed YAML, no current hold flag](../data/corpus/spanda-karikas.yaml) |
| Tantrasāra | `CC-BY-NC` | [GRETIL mirror-derived YAML](../data/corpus/tantrasara.yaml) |
| Vijñāna Bhairava Tantra | `NC` | [Muktabodha-attributed YAML; GRETIL cross-reference](../data/corpus/vijnana-bhairava-tantra.yaml) |

The source URL, recorded license and permission-hold flag can describe different aspects of source history. For example, a Wikisource URL does not justify removing a hold without reviewing which transcription was actually used. Translation rows carry their own license/source fields independently of the text's metadata. Preserve source revision and manuscript references when changing a reading, and record an editorial correction rather than presenting it as the untouched source.

## Data contracts

The executable shape is [the Zod corpus schema](../src/lib/seo/corpus-schema.ts); [schema.json](../data/corpus/schema.json) is generated by [schema-gen.ts](../scripts/schema-gen.ts). The [schema freshness test](../tests/unit/schema-gen-freshness.test.ts) prevents the checked-in JSON Schema from drifting. Start an addition from [the corpus template](../data/corpus/_template.yaml), preserving the source's transcription and attribution.

The canonical document has `schema_version`, `text`, and `chapters`, with optional `seo` and `faq_file`. The parser also accepts the legacy flat metadata shape and normalizes it to this document; generated JSON Schema describes the canonical nested shape. Text metadata includes stable `id` and route `slug`, Sanskrit/English/IAST titles, author, tradition, source URL and revision, license, attribution HTML, optional parent text and manuscript URL. `pending_miri` is an editorial source field read by the publisher; it is not a database column. `expected_verse_count`, when supplied, validates the count before committing that text.

A minimal shape illustrating existing fields is:

```yaml
schema_version: 1
text:
  id: example-text
  slug: example-text
  title_sa: उदाहरणम्
  title_en: Example
  tradition: trika
  license: PD
chapters:
  - chapter: 1
    verses:
      - verse: 1
        devanagari: उदाहरणम्
        iast: udāharaṇam
        section_type: prose
        prose_block_ref: example-1.1
        translations:
          - lang: en
            translator: Example contributor
            text: An example.
            license: CC-BY-SA-4.0
            status: draft
            ai_assisted: false
```

This is a contract illustration, not a new source text or evidence of licensing. `verse` and `verse_num` are input aliases; `text` and `translation_text` are translation aliases. Chapter and unit addresses are positive integers. Chapter-video rows use `verse_num=0` in the video table; corpus units do not use that sentinel.

Gloss input supports `word`/`word_sa`, `iast`/`lemma_iast`, `gloss`/`gloss_en`/`gloss_text`, and multilingual `gloss_hi` etc. [ingest.ts](../pipeline/ingest/ingest.ts) normalizes the surface word to Devanāgarī with Sanscript when the input is IAST, keeps explicit lemma data, assigns an index if omitted, and expands each language's gloss into a separate row. It does not silently correct Sanskrit source readings. [prose.ts](../src/lib/prose.ts) distinguishes prose presentation.

## Ingestion and integrity

The credentials-free path is:

```bash
bun install
bun run db:build
bun pipeline/ingest/migrations.ts
```

`db:build` initializes and ingests the local ignored `db/sohamhamso.db`; it does not connect to a production database. To isolate a trial, give both steps a new path in an existing directory:

```bash
bun pipeline/ingest/init-db.ts --db /tmp/sohamhamso-corpus-trial.db
bun pipeline/ingest/ingest.ts --db /tmp/sohamhamso-corpus-trial.db --dir data/corpus
bun pipeline/ingest/migrations.ts --db /tmp/sohamhamso-corpus-trial.db
```

The initializer applies [schema.sql](../db/schema.sql) idempotently. Existing columns need [numbered migrations](../db/migrations), rather than assuming `CREATE TABLE IF NOT EXISTS` upgrades a table. [migrations.ts](../pipeline/ingest/migrations.ts) sorts migrations, rejects duplicate numbers, records `schema_migrations`, and uses guard probes to converge fresh and older databases. Each migration and its ledger stamp commit together. Numbered migrations operate only on local SQLite; unsupported backend arguments fail before opening a database. Production subscriber migrations use D1 through the deployment runbook.

Ingestion parses all files before processing and topologically sorts parent/commentary dependencies. A dependency cycle fails explicitly. Each text's upserts and reconciliation form one transaction; a later text can fail after earlier texts have committed, so the whole corpus run is not an atomic replacement.

The stable keys are `(text_id, chapter, verse_num)` for units, `(verse_id, lang, translator)` for translations, and `(verse_id, word_idx, gloss_lang)` for glosses. Missing translators normalize to `unattributed`, avoiding SQLite's distinct-NULL uniqueness behavior. Re-ingesting unchanged text and translation content preserves their `updated_at` values through NULL-safe comparison guards.

Reconciliation removes units, translations, glosses, parallels, and chapter titles no longer present under an ingested text. It does not perform a repository-wide text deletion when an entire YAML file disappears. Most importantly, it can delete translations generated only in a database: commit accepted content into YAML before rebuilding that database. A video pins `translations.id`; deleting a pinned translation fails the foreign key and rolls back that text, preserving media provenance instead of orphaning it.

The run rebuilds [lemma_index](../pipeline/ingest/lemma-index.ts) from distinct gloss lemmas, using the same slug collision walk as static lemma pages. This moves corpus-wide counting out of request-time verse reads. Counts represent distinct unit occurrences, not the number of language gloss rows. Finalization checkpoints WAL, switches to rollback journaling, compacts, and removes sidecars to leave a self-contained database artifact.

## Morphology, lexicon, and enrichment

The checked-in glosses and labels are source data. The [Vidyut morphology pipeline](../pipeline/morph/README.md) is a separate deterministic audit: Python reads corpus YAML, runs `vidyut-cheda`, and writes ignored `data/morph/{slug}.json`; Bun compares those results with YAML glosses. Missing Vidyut or linguistic data causes a nonzero exit rather than invented analysis. Default input transliterates IAST to SLP1 because some legacy `slp1` fields use incompatible Harvard-Kyoto conventions.

The comparator handles sandhi splits, compound alignment and lemma spelling conventions. Its categories are review triage, not proof of semantic correctness. `mw_headword_candidate` is a proposed dictionary lookup key, not a verified Cologne headword. The translator reads database glosses and morphology strings; it does not load these generated Vidyut audit files. DCS, Skrutable, and additional dictionary integrations described in historical plans should not be inferred from a populated `morph` or `meter` field.

[Translation shard merging](../pipeline/translate/merge_indic.py) accepts whole-text `{lang}.json` and complete per-chapter `{lang}/ch{N}.json` layouts. It validates missing chapter files and invalid unit references before writing that text. Shards carry their own model metadata; legacy model extraction uses the translator label. A `[draft] ` prefix is stripped and changes status to `draft`. Re-merging replaces the first matching language entry, whereas the database can represent multiple translators for one language: review the diff when retaining parallel translations.

## Storage responsibilities and consumers

The local SQLite schema includes corpus, vectors, subscribers, video state and operational tables for development. That co-location is not an instruction to export or expose all tables. [db.ts](../src/lib/db.ts) provides build/local reads; [corpus-db.ts](../src/lib/corpus-db.ts) provides an asynchronous local SQLite interface for tools and tests. Public reader, search and OG requests consume generated assets; subscriber requests use D1. Web reads filter translations to `reviewed`/`published`; media eligibility and pinned translation IDs provide a separate publishing boundary.

The storage boundaries above include the 2026-10-25 static corpus/D1 release; the corpus measurements retain their dated `4c94bf2` baseline. Consult [architecture](ARCHITECTURE.md) and [the deployment runbook](D1-CUTOVER.md) for current runtime and verification instructions.

## Dataset export and release procedure

The publisher opens the selected SQLite database read-only and writes bundle artifacts; it does not insert a `dataset_releases` record or update operational database state.

[The publisher](../pipeline/dataset/publish.ts) creates `dataset/build/sohamhamso-dataset-vYYYY.MM.DD/` with five relational CSVs (`texts`, `verses`, `translations`, `word_glosses`, `parallels`), per-text denormalized JSON, minimal TEI XML, README, attribution, license, changelog, and `checksums.sha256`. It does not export embeddings, subscriber data, quota ledgers, media state, `lemma_index`, or chapter-title rows.

Headers come from explicit lists in `publish.ts`, not a dynamic schema dump. In this baseline, `verses.csv` and JSON omit `section_type` and `prose_block_ref`, despite those columns existing in the database; this is a format limitation. TEI is minimal, not a full scholarly critical edition. JSON translations expose `text` and a boolean `ai_assisted`; CSV uses `translation_text` and SQLite's 0/1 flag. For example, a JSON translation object can contain:

```json
{"lang":"hi","translator":"sohamhamso (claude-opus-4-7)","text":"…","status":"published","ai_assisted":true,"model":"claude-opus-4-7","model_version":null,"prompt_version":"v1-sanskrit-grounded","judge_score":null,"reviewer":null,"reviewed_at":null}
```

The publisher excludes drafts and all six `pending_miri` texts, including their child rows and parallels crossing a held boundary. For the measured baseline, **5 texts, 377 units and 4,524 translations** pass these automated filters. This is export eligibility, not a legal clearance decision. Parātrīśikā and Īśvarapratyabhijñākārikā have recorded **CC-BY-NC-SA 4.0** source terms; source restrictions remain applicable even when the generated bundle contains a CC-BY-SA license file. Karpūrādi's source attribution also records permission restrictions. Preserve per-source terms and resolve redistribution permission before public release.

Build and inspect locally, without depositing:

```bash
bun pipeline/dataset/publish.ts --version v2026.10.12 --out /tmp/sohamhamso-dataset-review
cd /tmp/sohamhamso-dataset-review/sohamhamso-dataset-v2026.10.12
shasum -a 256 -c checksums.sha256
```

The checksum file is written last and does not hash itself. The release date format is enforced; semantic versioning proposals in older docs are not implemented. Review source permissions, exported counts, JSON/TEI and filtered rows before publication.

[zenodo-deposit.ts](../pipeline/dataset/zenodo-deposit.ts) defaults to a local metadata/file-list dry run and writes `zenodo-deposit.json`; `--execute` creates, uploads and publishes an external deposit with `ZENODO_API_KEY`. `--sandbox` changes the endpoint. Each execution creates a deposit; it is not a verified version-update or rollback workflow. Adding the provenance JSON after building means it is outside the original checksum manifest. No DOI or published Zenodo release is established by the repository baseline; placeholder DOI strings must not be cited as publications.

## Verification and failure recovery

The meaningful regression coverage is [ingestion](../tests/unit/ingest.test.ts), [reconciliation](../tests/unit/ingest-reconcile.test.ts), [migrations](../tests/unit/migrations.test.ts), [schema generation](../tests/unit/schema-gen-freshness.test.ts), [translation merges](../tests/unit/translate-merge-indic.test.ts), [dataset exports](../tests/unit/dataset-publish.test.ts), and [MIRI filtering](../tests/unit/dataset-publish-miri.test.ts). Run these with the repository's Bun Vitest command; Python merge tests need `ruamel.yaml`, and morphology requires its separately installed tools/data.

On a failed ingest, retain the source diff and error, correct the failing document, and re-run into the isolated database first. On a foreign-key failure involving videos, inspect pinned translation/media lineage before removing content. On a partial export, rebuild to a fresh output directory and verify every checksum. On an interrupted Zenodo execution, inspect the remote deposition ID before re-executing to avoid creating duplicate deposits.

Related: [AI systems](AI-SYSTEMS-AND-EVALUATION.md), [video platform](AI-VIDEO-AND-YOUTUBE-PLATFORM.md), [security and licenses](SECURITY-PROVENANCE-AND-LICENSES.md), and [translation provenance decision](decisions/003-translation-provenance.md).
