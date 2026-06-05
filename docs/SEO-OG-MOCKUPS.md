# SEO OG Mockups

This document locks the intended OG card variants for the current repo state.
It is a docs-scoped substitute for the original planned `.gstack/seo/og-mockups.md`.

## Locked Variants

### 1. Short Verse

- Layout: title left, citation right, Sanskrit verse block, secondary row, footer strip
- Typography:
  - Sanskrit block starts at `32px`
  - secondary row uses serif `30px`
- Overflow: no truncation if the verse fits within three lines at base size

### 2. Long Verse

- Same layout as the short verse
- Overflow rule is fixed:
  - shrink Sanskrit block `32px -> 28px -> 24px`
  - if it still overflows at `24px`, truncate to the first pada and append `॥…॥`
- Citation and wordmark stay visible in all states

### 3. Indic-Locale Verse

- Sanskrit Devanagari stays as the primary block
- The secondary row swaps from IAST to the requested locale translation
- Footer shows locale label and fallback state if English fallback was used

### 4. Lemma Card

- Distinct layout from verse cards
- Shows:
  - lemma label
  - Sanskrit form when present
  - IAST form
  - gloss in requested locale or English fallback
  - occurrence count
  - sample verse path

## Current Implementation Status

- Implemented:
  - dynamic verse and lemma OG endpoints under `functions/og`
  - locked overflow behavior in the deterministic template renderer
  - dynamic PNG success responses via `@resvg/resvg-wasm`
  - 1200x630 static PNG fallback asset at `public/og-default.png`
- Remaining external-only validation:
  - social debugger verification against a live deploy
  - post-deploy crawler verification of the success path

## Runtime Note

The current runtime keeps the existing SVG template contract for layout/overflow, then rasterizes that output to PNG in `functions/og/_shared.ts`.
