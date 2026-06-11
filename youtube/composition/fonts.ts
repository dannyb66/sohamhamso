/**
 * youtube/composition/fonts.ts
 *
 * Registers the two typefaces the Short composition needs:
 *   - EB Garamond          (Latin / IAST diacritics)  → public/fonts/latin/eb-garamond-variable.woff2
 *   - Noto Serif Devanagari (on-screen Sanskrit)       → public/fonts/indic/noto-serif-devanagari-variable.woff2
 *
 * Both are variable woff2 files shipped in the repo. We load them via
 * `@remotion/fonts` `loadFont()` so Chromium has the glyphs available before
 * the first frame is rendered (avoids tofu / FOUT on GHA Linux runners).
 *
 * NOTE: `remotion` and `@remotion/fonts` are installed by the orchestrator
 * later — these imports only resolve after `bun install`.
 */
import { loadFont } from '@remotion/fonts';
import { staticFile } from 'remotion';

export const FONT_FAMILY_LATIN = 'EB Garamond';
export const FONT_FAMILY_DEVANAGARI = 'Noto Serif Devanagari';

let fontsPromise: Promise<void> | null = null;

/**
 * Idempotently registers both font families. Safe to call from module top
 * level and again from a component; the underlying promise is memoised so the
 * woff2 files are only fetched/parsed once per render worker.
 */
export function loadFonts(): Promise<void> {
  if (fontsPromise) return fontsPromise;

  fontsPromise = Promise.all([
    loadFont({
      family: FONT_FAMILY_LATIN,
      url: staticFile('fonts/latin/eb-garamond-variable.woff2'),
      // variable weight axis
      weight: '400 700',
      style: 'normal',
    }),
    loadFont({
      family: FONT_FAMILY_DEVANAGARI,
      url: staticFile('fonts/indic/noto-serif-devanagari-variable.woff2'),
      weight: '400 700',
      style: 'normal',
    }),
    loadFont({
      family: 'Noto Serif Tamil',
      url: staticFile('fonts/indic/noto-serif-tamil-variable.woff2'),
      weight: '400 700',
      style: 'normal',
    }),
    loadFont({
      family: 'Noto Serif Telugu',
      url: staticFile('fonts/indic/noto-serif-telugu-variable.woff2'),
      weight: '400 700',
      style: 'normal',
    }),
    loadFont({
      family: 'Noto Serif Kannada',
      url: staticFile('fonts/indic/noto-serif-kannada-variable.woff2'),
      weight: '400 700',
      style: 'normal',
    }),
    loadFont({
      family: 'Noto Serif Malayalam',
      url: staticFile('fonts/indic/noto-serif-malayalam-variable.woff2'),
      weight: '400 700',
      style: 'normal',
    }),
    loadFont({
      family: 'Noto Serif Bengali',
      url: staticFile('fonts/indic/noto-serif-bengali-variable.woff2'),
      weight: '400 700',
      style: 'normal',
    }),
    loadFont({
      family: 'Noto Serif Gujarati',
      url: staticFile('fonts/indic/noto-serif-gujarati-variable.woff2'),
      weight: '400 700',
      style: 'normal',
    }),
    loadFont({
      family: 'Noto Serif Gurmukhi',
      url: staticFile('fonts/indic/noto-serif-gurmukhi-variable.woff2'),
      weight: '400 700',
      style: 'normal',
    }),
    loadFont({
      family: 'Noto Serif Oriya',
      url: staticFile('fonts/indic/noto-serif-oriya-variable.woff2'),
      weight: '400 700',
      style: 'normal',
    }),
  ]).then(() => undefined);

  return fontsPromise;
}

/**
 * Convenience promise for callers that just want to `await` readiness
 * (e.g. delayRender wiring or tests). Resolves once both faces are registered.
 */
export const FONTS_READY: Promise<void> = loadFonts();
