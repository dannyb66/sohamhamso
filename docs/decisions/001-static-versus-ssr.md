# Decision 001: static indexes and on-demand verse rendering

Status: reconstructed from merged implementation at `4c94bf2`; written 2026-10-12. This record summarizes evidence in source comments and tests, rather than claiming a contemporaneous ADR or production measurement.

## Context and decision

The corpus has many references and 12 configured locales. Prerendering a separate page for every reference/language multiplies deployment file count. [Astro configuration](../../astro.config.mjs) records the move to SSR for verse routes to remain below the Pages file limit. Keep homepage/index/chapter/chrome/lemma content prerendered, while both verse route families export `prerender = false` and read the corpus at request time.

[readVersePage](../../src/lib/verse-read.ts) batches the verse anatomy's SELECTs through the async corpus backend. The [English route](../../src/pages/[tradition]/[text]/[chapter]/[verse].astro) and locale twin render initial HTML with SEO metadata and all-language payloads; Solid islands handle later preference changes.

## Consequences and verification

Build and deployment scale with index assets rather than every verse/language page. The reader now depends on a correctly seeded remote corpus and working runtime credentials. Routes distinguish an absent reference (404) from a backend failure (503, no-store) and return 301 for aliases. Long shared-cache headers do not themselves install Cloudflare edge caching.

[File-count gate](../../scripts/check-dist-filecount.ts), [gate tests](../../tests/unit/scripts/check-dist-filecount.test.ts), [SSR tests](../../tests/e2e/verse-ssr.spec.ts), and [reader data tests](../../tests/unit/verse-read.test.ts) support the decision. No cost/latency improvement is claimed without a dated measurement. Adding shared-cache rules later creates a corpus invalidation responsibility.

## Subsequent alternatives

Immutable static corpus assets with request-time HTML and D1 writes appear in an uncommitted original worktree inspected 2026-10-12. This is a subsequent alternative, not this decision's merged result. A cutover should demonstrate data parity, route parity, deployment state, and rollback before replacing these operating instructions.
