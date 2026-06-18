# pipeline/morph — Vidyut-grounded morphology

Deterministic, tool-derived morphological analysis for the corpus, and a
trust audit comparing it against the LLM-authored `word_glosses` already in
the YAML. This exists because the methodology page implies Vidyut-grounded
morphology; until this pipeline, the `morph` fields in the corpus were
LLM-self-generated. The trust review called that the credibility gap.

## The contract

- **Verbatim corpus in.** Input is `data/corpus/{slug}.yaml`, read-only.
- **Deterministic analyses out.** Output is exactly what
  [vidyut-cheda](https://github.com/ambuda-org/vidyut) produced — same input,
  same data version, same output. Full provenance (tool, version, data dir,
  input mode) is recorded in every output file.
- **No LLM in the loop.** Nothing in this pipeline calls a model. If Vidyut
  is not installed or its linguistic data is missing, the runner prints the
  install path and **exits nonzero**. It never fabricates analyses.

## Toolkit choice (research notes, 2026-06)

- **Vidyut** is Ambuda's Rust Sanskrit toolkit. The Python bindings are
  published as the [`vidyut` package on PyPI](https://pypi.org/project/vidyut/)
  (prebuilt wheels, no Rust toolchain needed; the old `vidyut-py` repo is
  deprecated — bindings now live in `bindings-python/` of the main repo).
  There is **no maintained npm/JS binding**, so this runner is Python —
  consistent with the existing Python steps in `pipeline/translate/*.py`.
- `vidyut.cheda.Chedaka(data_dir).run(slp1_text)` segments an SLP1 string
  and returns tokens with `.text` (surface), `.lemma` (may be `None` for
  words absent from the kosha), and `.data` (a `PadaEntry` carrying
  subanta/tiṅanta morphology). The API is marked **experimental** upstream.
- Linguistic data is a one-time download via `vidyut.download_data(path)`
  (fetched from the matching `ambuda-org/vidyut` GitHub release, ~60 MB,
  unpacks to `cheda/`, `kosha/`, `sandhi/`, `prakriya/`, `chandas/`).
- **Cologne MW**: Vidyut lemmas are SLP1 stems; transliterated to IAST they
  are the natural Monier-Williams lookup keys (CDSL,
  sanskrit-lexicon.uni-koeln.de). We emit them as `mw_headword_candidate`
  and do **not** claim they are verified MW headwords — see "MW headwords"
  below.

## Install

```sh
# 1. Python env with vidyut (prebuilt wheels; needs Python >= 3.7)
uv venv pipeline/morph/.venv
uv pip install --python pipeline/morph/.venv/bin/python vidyut ruamel.yaml

# 2. One-time linguistic data download (~60 MB)
pipeline/morph/.venv/bin/python -c \
  "import vidyut; vidyut.download_data('$HOME/.cache/sohamhamso/vidyut-data')"
```

The data location defaults to `~/.cache/sohamhamso/vidyut-data` and can be
overridden with `VIDYUT_DATA_DIR`. The venv and all outputs are gitignored.

## Usage

```sh
# 1. Segment + analyze -> data/morph/{slug}.json
pipeline/morph/.venv/bin/python pipeline/morph/runner.py siva-sutras

# 2. Trust audit vs the LLM word_glosses -> data/morph/{slug}-audit.json
bun pipeline/morph/audit.ts siva-sutras
```

Without Vidyut installed, step 1 prints these install steps and exits `2`
(`3` if only the data is missing). Outputs are not committed yet
(`data/morph/.gitignore`); regenerate locally.

### Input handling

By default the runner transliterates each verse's **`iast` field** to SLP1
(deterministic table in `runner.py`, mirrored in `compare.ts`). Several
corpus `slp1` fields are Harvard-Kyoto-flavored (e.g. `caitanyamAtmA` where
SLP1 requires `cEtanyamAtmA`), which corrupts segmentation — `--input slp1`
uses the raw field if you want to audit exactly that. Fixing the corpus
`slp1` fields is a follow-up for the corpus owners.

## Output shapes

`data/morph/{slug}.json` (runner):

```jsonc
{
  "text_slug": "siva-sutras",
  "tool": { "name": "vidyut-cheda", "package": "vidyut (PyPI)", "version": "0.4.0", "data_dir": "..." },
  "contract": "verbatim corpus in, deterministic vidyut-cheda analyses out, no LLM",
  "verses": {
    "1.5": {
      "input": "udyamo BEravaH",
      "input_source": "iast (transliterated to SLP1)",
      "tokens": [
        {
          "surface": "udyamas",
          "lemma": "udyam",
          "lemma_iast": "udyam",
          "mw_headword_candidate": "udyam",   // MW lookup key, NOT verified
          "pos": "subanta",
          "tags": { "linga": "puM", "vibhakti": "praTamA", "vacana": "eka" },
          "entry": "PadaEntry.Subanta(...)"   // full vidyut repr, for provenance
        }
      ]
    }
  }
}
```

`data/morph/{slug}-audit.json` (audit): per gloss word, the aligned Vidyut
tokens, a classification (`match` / `split` / `merged` / `split_crossing` /
`mismatch` / `unmatched`), a lemma-level `lemma_agreement` boolean with its
`match_kind`, a `dhatu_flag`, and — for disagreements — a triage `category`,
plus a summary with aligned/agreement rates and category counts. All
comparison logic is pure and lives in `compare.ts`; tests in
`tests/unit/morph-compare.test.ts` run with fixtures only — no Vidyut
required.

## Calibration methodology (v2, 2026-06)

The first audit compared raw lemma strings and read 24–47% agreement. Most
of those "disagreements" were methodological, not semantic, so the
comparator was calibrated in three ways:

**1. Sandhi-aware alignment (word -> pada SET).** vidyut-cheda sandhi-splits
surface words that the YAML `word_glosses` keep whole (and vice versa: the
glosses hyphenate compounds and sometimes carry multi-word entries like
`idaṃ sarvam`). Each gloss word is split on hyphens/whitespace into parts
and aligned to one-or-more contiguous Vidyut padas by surface coverage:
exact character spans when the normalized concatenations agree
(`alignment_mode: "exact-span"`), otherwise spans are projected through a
character-level Levenshtein alignment of the two concatenations
(`alignment_mode: "greedy"`), which keeps word→pada mapping stable even
when the two sides resolved sandhi differently (`turya-ābhogaḥ` vs
`turyās + bhoga`). A gloss word counts as agreeing if **any** aligned
pada's lemma matches the word or its covering part after normalization.

**2. Lemma normalization.** Comparison happens in SLP1 (IAST intake is
NFC-normalized and lowercased; SLP1 itself stays case-sensitive, i.e.
diacritic-exact). The normalizer covers the systematic convention gaps:

- SLP1 <-> IAST transliteration (`slp1ToIast` mirrors what
  `pipeline/ingest/ingest.ts` does via `@indic-transliteration/sanscript`;
  cross-checked against sanscript in the unit tests);
- visarga/anusvāra variants (`-aḥ ~ -as ~ -a`, `-ṃ ~ -m`) and
  anusvāra/class-nasal spelling (`śaṅkara ~ śaṃkara`);
- final-vowel nominal-stem variants (`-am/-a`, `-ā/-an`, loc. `-e/-a`,
  `-au/-i|-u|-a`, abl. `-āt/-a`, common oblique endings, final vowel
  length) plus a guarded stem-prefix rule (lemma must cover >= half the
  word);
- suppletive pronominal paradigms (`teṣām ~ tad`, `yaḥ ~ yad`,
  `asau ~ adas`) via an explicit form table;
- **dhātu vs derived stem is flagged, never force-matched**: vidyut
  lemmatizes tiṅantas and kṛdanta-derived nouns to the root (`saṃhāraḥ ->
  saṃhṛ`, `jñānam -> jñā`). Those rows get `dhatu_flag: true` and stay in
  the disagree column — they are convention differences, not refutations.

**3. Disagreement categories.** Every disagreeing row gets a `category`
(deterministic heuristics — triage, not verdicts):

- `vidyut_segmentation` — null lemmas (kosha misses), micro-token
  shredding (`caitanyam -> ca/Et/an/yam`), splits with no lemma support,
  known pronoun/indeclinable forms given quirky lemmas (`yaḥ -> I`);
- `legitimate_ambiguity` — dhātu-vs-derived-stem convention (the large
  majority), alternative sandhi resolutions, related lexeme choices;
- `unresolved_alignment` — no padas to align (incl. verses where the
  Chedaka returned an empty segmentation), boundary-straddling tokens, or
  >50% character divergence;
- `llm_gloss_error` — alignment exact, a single clean non-dhātu pada, and
  an unrelated lemma: the strongest string-level signal that the
  gloss-side analysis is off.

## How to read the audit (important)

**Disagreement does not mean the LLM gloss is wrong.** vidyut-cheda 0.4 is
experimental and visibly over-segments terse sūtra text and vocabulary
absent from its kosha. Calibrated results on this corpus (2026-06, vidyut
0.4.0 / data 0.4.0); "dhātu-conv." is the share of disagreements that are
the flagged root-vs-derived-stem convention:

| text | words | aligned | lemma agree | + dhātu-conv. | vidyut-side | unresolved | LLM-error |
|---|---|---|---|---|---|---|---|
| siva-sutras | 189 | 98.9% | 50.3% | 85.2% | 23 | 2 | 0 |
| karpuradi-stotra | 489 | 93.5% | 48.9% | 79.6% | 57 | 30 | 0 |
| spanda-karikas | 533 | 96.8% | 46.0% | 85.2% | 62 | 13 | 0 |
| vijnana-bhairava-tantra | 1074 | 88.8% | 43.8% | 69.1% | 239 | 70 | 0 |
| pratyabhijna-hrdayam | 104 | 97.1% | 39.4% | 83.7% | 13 | 2 | 0 |

Honest caveats that remain:

- The categories are **string-level heuristics**. They cannot judge whether
  a gloss's *meaning* or case/number labels are right — only whether the
  implied lexeme is corroborated. A human with a grammar still owns
  `vidyut_segmentation` and `unresolved_alignment` rows.
- The ANY-pada rule is deliberately generous: one matching pada vouches for
  a whole compound. `parts_matched`/`parts_total` per row shows how much of
  a compound was actually corroborated.
- The dhātu flag marks convention, not correctness: `jñānam -> jñā` is
  consistent derivation, but the comparator does not verify the derivation
  itself.
- vidyut returns an **empty segmentation** for some whole verses (e.g.
  vijnana-bhairava-tantra 1.13, karpuradi-stotra 1.6); their words land in
  `unresolved_alignment`, which is why vijnana's aligned% is lowest.
- `llm_gloss_error: 0` across all five texts means no gloss was *refuted*
  at the string level — it is evidence of soundness, not proof.

Treat the audit as a **human-review triage queue**. What the methodology
page may honestly claim today is "morphology cross-checked against Vidyut,
with the disagreement audit published" — not "morphology generated by
Vidyut".

## MW headwords

`mw_headword_candidate` is the Vidyut lemma transliterated to IAST — the key
you would look up in Cologne MW. It is emitted as a *candidate* because it
is not verified against the actual MW headword list. Follow-up: download the
CDSL MW headword index (sanskrit-lexicon.uni-koeln.de offers the full
digitization for download) and add a verification pass that sets a
`mw_verified` flag. Until then, nothing in the site should render these as
confirmed MW links.

## Files

- `runner.py` — vidyut-cheda segmentation; Python because the only solid
  Vidyut binding is the PyPI package. Exit codes: 0 ok, 1 usage, 2 vidyut
  missing, 3 data missing.
- `compare.ts` — pure comparison/alignment logic (transliteration,
  normalization, alignment, audit construction). No I/O, no dependencies.
- `audit.ts` — Bun CLI wrapping `compare.ts`; reads the corpus YAML +
  runner output, writes the audit. Exit codes: 0 ok, 1 usage, 4 runner
  output missing.
