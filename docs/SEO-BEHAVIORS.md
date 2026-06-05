# SEO Behaviors

This document describes the SEO surface that currently ships in the repo.

## Verification Record

The authoritative local verification artifact for this slice is:

- `.gstack/seo/verification-2026-06-03.md`

Rerun the local checks with:

- `bun run seo:audit-lemma-slugs`
- `bun run seo:verify-phase0`
- `bun run seo:validate`

If a statement here conflicts with the `.gstack` artifact, treat the `.gstack` record as the source of truth.

## Current Surface

The build currently emits:

- canonical, Open Graph, Twitter, keywords, and JSON-LD metadata through the shared `src/lib/seo` builders
- localized mirrors for home, texts, cite, daily, dataset, donate, `about/*`, tradition, text, verse, and lemma pages under `/{lang}/...`
- `robots.txt`, `sitemap-index.xml`, and child sitemaps for verses, texts, chrome pages, and lemmas
- redirect rules in `public/_redirects`, generated from the alias/tradition redirect manifest
- dynamic PNG OG endpoints under `functions/og`, backed by the deterministic template renderer plus `@resvg/resvg-wasm`
- repo-served font assets under `public/fonts` with preload wiring in `BaseLayout`

Chrome pages that are meant to stay English-only still use explicit metadata builders. `search`, `confirmed`, `unsubscribed`, and `/sample` are explicitly `noindex`.

## Source Of Truth

The corpus remains the source of truth in this order:

1. `text` metadata for identity, titles, tradition, provenance, and descriptions
2. `chapters[].verses[]` for the routable content inventory
3. `translations[]` and `word_glosses[]` for per-language availability
4. optional top-level `seo` and `faq_file` overrides, loaded directly from `data/corpus/*.yaml` by `src/lib/seo/corpus-overrides.ts`

The SEO layer does not invent availability. If a translation or gloss is not present in the corpus, the route may still exist, but it is treated as non-indexable and excluded from hreflang clusters and sitemaps.

## Route And Locale Rules

- English is the root locale.
- Non-English mirrors live under `/{lang}/...`.
- Locale rollout is staged:
  - default: only English is considered live
  - `LOCALE_URLS_LIVE=true`: all configured locales are live
  - `LOCALE_URLS_LIVE_LANGS=hi,ta,...`: only that allowlist plus English is live
- A page that is not live for its locale is marked `noindex` and omitted from hreflang + sitemap output.

## Lemma Rules

- Standalone lemma pages are generated only for lemmas with `occurrenceCount >= 3`.
- Standalone lemma pages live at `/lemma/[slug]` and `/{lang}/lemma/[slug]`.
- Lemmas below that threshold remain verse-local:
  - they stay in the verse anatomy / word sheet UI
  - the verse page emits inline `DefinedTerm` JSON-LD pointing at the term anchor on that verse
- Lemma slugs are auto-derived from IAST and de-duplicated deterministically.

## Metadata Rules

- All metadata builders live under `src/lib/seo/metadata.ts`.
- Canonical URLs, hreflang clusters, and OG URLs are built from the same route helpers.
- A `noindex` page must not emit hreflang alternates.
- Verse pages require a translation to be indexable.
- `seo.noindex_langs` removes those locale variants from text/verse hreflang clusters and marks the affected localized pages `noindex`.
- `seo.descriptions.{lang}` and `seo.keywords.{lang}` override only that locale's text-page metadata; otherwise builders fall back to derived defaults.
- `faq_file` is resolved relative to the corpus YAML and emits `FAQPage` JSON-LD on text pages only when both the question and answer exist for that locale.
- Chrome pages should use `buildChromeSeo(...)` instead of falling back to `BaseLayout` defaults.

## Sitemaps And Robots

- `sitemap-index.xml` includes verses, texts, lemmas, and chrome surfaces.
- Pages excluded by `noindex` or rollout gating are excluded from child sitemaps.
- `robots.txt` points crawlers at the sitemap index and uses the same locale rollout policy.

## Tooling

The main SEO commands are:

- `bun run seo:redirects`
- `bun run seo:build`
- `bun run seo:ping -- --origin=https://sohamhamso.org`
- `bun run seo:verify-phase0`
- `bun run seo:validate`
- `bun run seo:preview`
- `bun run seo:audit-lemma-slugs`
- `bun run seo:rebuild`

CI runs `seo:build` and `seo:validate` before the main test suite.

## Known Limits

- The current local `seo:validate` run passes, including the localized chrome links from `/{lang}/cite` into localized `/{lang}/about/*` pages.
- The local Phase 0 helper validates both the dynamic PNG success path and the PNG fallback asset path under `functions/og`, plus URL parsing/cache-key normalization. It is still not a substitute for deployed crawler verification.
- External validation is still pending:
  - Googlebot/Search Console inspection
  - live SERP / demand checks
  - social debugger validation
  - post-deploy crawl verification
- The current self-hosted font bundle uses repo-served `ttf` / `ttc` binaries rather than curated `woff2` packages. Deterministic delivery is in place, but redistribution/licensing should be reviewed before public release.
