# SEO Verification — 2026-06-03

This is the operator-facing pointer for the local SEO parity verification slice.

## Authoritative Record

The detailed, evidence-backed verification artifact lives at:

- `.gstack/seo/verification-2026-06-03.md`

That file is the source of truth for:

- exact commands run
- exact local outputs observed
- what was and was not locally verifiable in this workspace

## Rerun Commands

Run these from repo root:

```bash
bun run seo:audit-lemma-slugs
bun run seo:ping -- --origin=https://sohamhamso.org
bun run seo:verify-phase0
bun run seo:validate
```

## Current Local Status

- `bun run seo:validate` passes on the current local build snapshot.
- The localized chrome surface referenced by `/{lang}/cite` is present in the repo, including localized `/{lang}/about/*` pages.
- `bun run seo:verify-phase0` now verifies both:
  - dynamic PNG success responses from `functions/og`
  - PNG fallback asset responses when the OG runtime asset is unavailable

## Current Local Downgrades

- The local Phase 0 helper is still not a substitute for deployed crawler behavior.
- The self-hosted font bundle currently uses repo-served `ttf` / `ttc` assets rather than curated `woff2` packages.
- Googlebot/Search Console checks, social debugger checks, and post-deploy crawl validation remain external-only.
