/**
 * Slug + tradition aliasing for reader URLs.
 *
 * Users frequently type:
 *   - the wrong tradition prefix (e.g. /trika/karpuradi-stotra — actually shakta)
 *   - a romanization variant of the slug (e.g. pratyabhijna-hridayam vs canonical hrdayam)
 *
 * These are real UX traps: a 404 makes the reader look broken even though the
 * content exists. This module is the single source of truth for the alias
 * surface, consumed by:
 *   - src/pages/[tradition]/[text]/[chapter]/[verse].astro (getStaticPaths)
 *   - src/pages/[tradition]/[text]/index.astro            (getStaticPaths)
 *
 * Strategy: enumerate all (wrongTradition, aliasSlug) variants at build time
 * and emit redirect HTML pages. The Cloudflare adapter turns these into real
 * 301/308 redirects via the platform's static-file serving rules.
 *
 * All exported functions are PURE (no I/O beyond `listTexts()`).
 */

import { type TextSummary, listTexts } from './db';

/**
 * Curated slug alias map.
 *
 * Key   = non-canonical slug the user might type
 * Value = canonical slug present in the DB
 *
 * Add new entries when you ship a new text whose romanization has multiple
 * common spellings. Keep the canonical slug aligned with the romanization
 * convention used by `data/corpus/<slug>.yaml`.
 *
 * Sound-equivalence rules of thumb:
 *   - vocalic ṛ → "r" or "ri" (hr̥dayam ↔ hrdayam ↔ hridayam)
 *   - ś         → "s" or "sh" (śiva ↔ siva ↔ shiva)
 *   - long ū    → "u" or "uu" (kapūra ↔ karpura ↔ karpuura)
 *   - sandhi    → spelled-out compound (karpūrādi ↔ karpura-adi)
 */
export const SLUG_ALIASES: Record<string, string> = {
  // Pratyabhijñā-hr̥dayam: vocalic ṛ romanized as "ri" by lay readers
  'pratyabhijna-hridayam': 'pratyabhijna-hrdayam',
  // Śiva Sūtras: "sh" vs "s" for ś
  'shiva-sutras': 'siva-sutras',
  // Karpūrādi Stotra: split-compound and long-ū variants
  'karpura-adi-stotra': 'karpuradi-stotra',
  'karpuradi-stotram': 'karpuradi-stotra',
  'karpuuradi-stotra': 'karpuradi-stotra',
  // Vijñāna Bhairava Tantra: common 'vijnan' typo and short forms
  'vijnan-bhairava-tantra': 'vijnana-bhairava-tantra',
  'vijnana-bhairava': 'vijnana-bhairava-tantra',
  // Spanda Kārikās: singular vs plural
  'spanda-karika': 'spanda-karikas',
};

/** Known traditions (extend if DB grows). */
export const KNOWN_TRADITIONS = ['trika', 'shakta', 'kaula', 'shaiva'] as const;
export type KnownTradition = (typeof KNOWN_TRADITIONS)[number];

/**
 * Resolve a (tradition, textSlug) pair against canonical DB rows.
 *
 * Returns:
 *   - null               → unknown text (genuine 404 — let it fall through)
 *   - {canonical: true}  → the params already match DB; render as normal
 *   - {canonical: false} → params don't match; caller should redirect to
 *                          `canonicalTradition` + `canonicalSlug`
 */
export function resolveAlias(
  tradition: string,
  textSlug: string,
  texts: TextSummary[] = listTexts(),
):
  | { canonical: true; canonicalTradition: string; canonicalSlug: string }
  | { canonical: false; canonicalTradition: string; canonicalSlug: string }
  | null {
  const canonicalSlug = SLUG_ALIASES[textSlug] ?? textSlug;
  const t = texts.find((x) => x.slug === canonicalSlug);
  if (!t) return null;
  if (t.tradition === tradition && t.slug === textSlug) {
    return {
      canonical: true,
      canonicalTradition: t.tradition,
      canonicalSlug: t.slug,
    };
  }
  return {
    canonical: false,
    canonicalTradition: t.tradition,
    canonicalSlug: t.slug,
  };
}

/**
 * Enumerate every non-canonical (tradition, slug) pair that should redirect
 * to a canonical text. Used by getStaticPaths to mint redirect pages.
 *
 * For each text in the DB:
 *   - cross-product with every OTHER known tradition → wrong-tradition redirects
 *   - cross-product with every alias slug that points to this text, across
 *     ALL known traditions (including the canonical one) → slug-variant redirects
 *
 * The canonical (tradition, slug) pair is NOT emitted here — that's the live
 * page, and emitting it again would collide in Astro's route table.
 */
export function enumerateRedirectPairs(texts: TextSummary[] = listTexts()): Array<{
  wrongTradition: string;
  wrongSlug: string;
  canonicalTradition: string;
  canonicalSlug: string;
}> {
  const out: Array<{
    wrongTradition: string;
    wrongSlug: string;
    canonicalTradition: string;
    canonicalSlug: string;
  }> = [];
  const seen = new Set<string>();
  const push = (
    wrongTradition: string,
    wrongSlug: string,
    canonicalTradition: string,
    canonicalSlug: string,
  ) => {
    if (wrongTradition === canonicalTradition && wrongSlug === canonicalSlug) {
      return; // skip canonical — it's the real page
    }
    const key = `${wrongTradition}/${wrongSlug}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ wrongTradition, wrongSlug, canonicalTradition, canonicalSlug });
  };

  for (const t of texts) {
    // 1. Wrong tradition + canonical slug
    for (const wrong of KNOWN_TRADITIONS) {
      push(wrong, t.slug, t.tradition, t.slug);
    }
    // 2. Every alias slug, paired with every known tradition
    for (const [alias, canon] of Object.entries(SLUG_ALIASES)) {
      if (canon !== t.slug) continue;
      for (const trad of KNOWN_TRADITIONS) {
        push(trad, alias, t.tradition, t.slug);
      }
    }
  }
  return out;
}
