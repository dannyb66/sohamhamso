# Contributing Corpus Files

This document is the schema contract for `data/corpus/*.yaml`. Use it with:

- `data/corpus/_template.yaml` for a copy-pasteable starting point
- `data/corpus/_template.faq.yaml` for optional FAQ siblings
- `data/corpus/schema.json` for editor validation
- `data/corpus/faq.schema.json` for FAQ-file editor validation
- `docs/INGESTION.md` for the larger ingestion workflow
- `src/lib/seo/corpus-schema.ts` for the runtime source of truth

## Canonical Shape

The canonical contributor shape is the current wrapped layout:

```yaml
schema_version: 1
faq_file: ./my-text.faq.yaml   # optional
seo:                           # optional
text:                          # required metadata block
chapters:                      # required content block
```

The existing ingest parser also accepts a flat top-level layout, but new files should use the wrapped shape above. It matches the current corpus files and keeps SEO-only fields (`seo`, `faq_file`) out of the DB-ingested text metadata block.

## Required Fields

Top level:

- `schema_version`: defaults to `1` if omitted, but include it in new files.
- `text`: required.
- `chapters`: required and must contain at least one chapter.

Within `text`:

- Required: `id`, `slug`, `title_sa`, `title_en`, `tradition`, `license`
- Optional: `title_iast`, `author`, `school`, `era`, `source`, `source_url`, `source_revision`, `attribution_html`, `parent_text_id`, `manuscript_url`, `description`
- `tradition` is currently constrained to `trika`, `shakta`, `kaula`, or `shaiva`
- `id`, `slug`, and `parent_text_id` use lowercase kebab-case

Within `chapters[].verses[]`:

- Required: `verse` or `verse_num`, and `devanagari`
- Optional: `slp1`, `iast`, `meter`, `book`, `manuscript_folio_ref`, `word_glosses`, `translations`

## Accepted Aliases And Defaults

The schema matches what the current ingest already accepts:

- `verse` or `verse_num`
- `word` or `word_sa`
- `iast` or `lemma_iast` inside a `word_glosses` entry
- `text` or `translation_text` inside a `translations` entry
- `gloss_en`, `gloss_text`, or `gloss` for the English gloss text

Defaults that the parser currently applies:

- Missing top-level `schema_version` becomes `1`
- Missing `translations[].lang` becomes `en`
- Missing `translations[].status` becomes `published`
- Missing `translations[].license` becomes `PD`
- Missing `word_glosses[].word_idx` is inferred from list order
- Missing `seo.schema_version` becomes `1`
- Missing `seo.descriptions`, `seo.keywords`, and `seo.noindex_langs` become empty

Contributors should still set `lang`, `status`, and `license` explicitly in authored content. The defaults exist for backwards compatibility, not as the preferred authoring style.

## Word Gloss Rules

`word_glosses` entries are where most accidental schema drift happens.

- Every entry needs a source word via `word` or `word_sa`.
- Every entry needs at least one gloss body: `gloss_en`, `gloss_text`, `gloss`, or a `gloss_{lang}` field.
- `gloss_{lang}` is valid in `data/corpus/*.yaml` only. It is not the shape for `data/glosses/{slug}/{lang}.json`, which uses `gloss_text`.
- The current corpus often stores `word` in IAST and lets ingest normalize it to Devanagari. That is allowed and intentional.

## Translation Rules

`translations` entries are per verse and per language.

- Every entry needs a language code from the current reading-mode set: `en`, `hi`, `mr`, `bn`, `as`, `gu`, `pa`, `kn`, `ml`, `or`, `ta`, `te`.
- Every entry needs a body via `text` or `translation_text`.
- `status` must be one of `draft`, `reviewed`, or `published`.
- `ai_assisted` may be `true`, `false`, `1`, `0`, or `null`.

## SEO Block

The `seo` block is optional and additive. It does not replace corpus truth.

- `seo.descriptions.{lang}` overrides the derived description for that locale's text page.
- `seo.keywords.{lang}` overrides the derived keyword list for that locale's text page.
- `seo.noindex_langs` marks specific non-English locale variants as non-indexable for the affected text family.
- `faq_file` points at a sibling YAML file used for text-page `FAQPage` JSON-LD.

The ingest pipeline validates `seo` and `faq_file`, but it still writes only the corpus text, verse, gloss, and translation rows to SQLite. FAQ files are skipped by corpus file discovery, and the SEO builders read `seo` and `faq_file` directly from the source YAML at build/render time.

## FAQ File Shape

FAQ files are optional sibling YAML files referenced by `faq_file`.

- Canonical path pattern: `./my-text.faq.yaml`
- Canonical top-level shape:

```yaml
schema_version: 1
faqs:
  - question: "What is this text?"
    answer: "One-sentence factual answer."
  - question:
      hi: "यह पाठ क्या है?"
    answer:
      hi: "एक वाक्य का उत्तर।"
```

- `question` and `answer` may each be either:
  - a single string, which is treated as English-only
  - a per-language map keyed by the current corpus language codes
- A locale page emits `FAQPage` JSON-LD only when both the question and answer exist for that locale.

## Worked Example

Start from `data/corpus/_template.yaml`, then replace:

- `id` / `slug` with the text slug you want on disk and in URLs
- `description` with a factual paragraph about the text
- chapter and verse content with the real corpus data
- optional `seo` values only if you need to override derived defaults

Use the smallest possible override surface. If the default title, description, keywords, FAQ, or indexability are already correct, omit the `seo` and `faq_file` fields entirely.
