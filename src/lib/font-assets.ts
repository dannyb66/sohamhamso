export const FONT_FAMILY_ASSETS = [
  {
    asset: '/fonts/latin/source-serif-4-roman.woff2',
    family: 'Source Serif 4',
  },
  {
    asset: '/fonts/latin/source-serif-4-italic.woff2',
    family: 'Source Serif 4',
  },
  {
    asset: '/fonts/ui/inter-variable.woff2',
    family: 'Inter',
  },
  {
    asset: '/fonts/indic/noto-serif-devanagari-variable.woff2',
    family: 'Noto Serif Devanagari',
  },
  {
    asset: '/fonts/indic/noto-serif-tamil-variable.woff2',
    family: 'Noto Serif Tamil',
  },
  {
    asset: '/fonts/indic/noto-serif-telugu-variable.woff2',
    family: 'Noto Serif Telugu',
  },
  {
    asset: '/fonts/indic/noto-serif-bengali-variable.woff2',
    family: 'Noto Serif Bengali',
  },
  {
    asset: '/fonts/indic/noto-serif-kannada-variable.woff2',
    family: 'Noto Serif Kannada',
  },
  {
    asset: '/fonts/indic/noto-serif-malayalam-variable.woff2',
    family: 'Noto Serif Malayalam',
  },
  {
    asset: '/fonts/indic/noto-serif-gujarati-variable.woff2',
    family: 'Noto Serif Gujarati',
  },
  {
    asset: '/fonts/indic/noto-serif-gurmukhi-variable.woff2',
    family: 'Noto Serif Gurmukhi',
  },
  {
    asset: '/fonts/indic/noto-serif-oriya-variable.woff2',
    family: 'Noto Serif Oriya',
  },
] as const;

export const FONT_ASSET_PATHS = FONT_FAMILY_ASSETS.map(({ asset }) => asset);

export const CORE_PRELOADED_FONT_ASSETS = [
  '/fonts/latin/source-serif-4-roman.woff2',
  // Italic face is required above-the-fold on:
  //   • home `/`     → `.hero-iast` IAST transliteration line
  //   • verse pages  → `<em>{lemma_iast}</em>` inside `.synonyms`
  // Without preload the italic file loaded ~600 ms later than its
  // siblings under Slow 4G, delaying the LCP paint.
  '/fonts/latin/source-serif-4-italic.woff2',
  '/fonts/ui/inter-variable.woff2',
  '/fonts/indic/noto-serif-devanagari-variable.woff2',
] as const;
