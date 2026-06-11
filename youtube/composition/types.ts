/**
 * youtube/composition/types.ts
 *
 * Pure-TypeScript contract for the Remotion composition. Lives in its own
 * file (no `react`/`remotion`/JSX imports) so non-Remotion code — e.g.
 * `pipeline/youtube/remotion-props.ts` — can import the `ShortProps` type
 * without dragging the React `.tsx` graph into the project's Solid-JSX
 * typecheck. The `.tsx` components re-import these types from here.
 */

export type ShortPreset = {
  bg: string;
  accent: string;
  text: string;
  headlineFont: string;
  bodyFont: string;
  devanagariFont: string;
  footerLine: string;
};

export type ShortProps = {
  textTitle: string; // "Śiva Sūtra"
  reference: string; // "1.1"
  devanagari: string; // "चैतन्यमात्मा"
  iast: string; // "caitanyam ātmā"
  translation: string; // English translation
  preset: ShortPreset;
  translationFont: string; // per-language script font for the translation line
  audioSrc: string | null; // narration file/URL; render silence if null
  audioStartFrame: number; // frame the English appears AND narration begins
  fps: number; // 30
  durationInFrames: number; // dynamic: leadIn + narration + tail (per verse)
};

/**
 * Translation-line script font per language. The on-screen Devanāgarī (Sanskrit
 * source) + IAST lines are ALWAYS Noto Serif Devanagari / EB Garamond — only the
 * translation text changes script per language, so only IT needs a per-language
 * font. Lives here (pure, no remotion) so the pipeline (render-engine) and the
 * composition share one source of truth.
 */
export const TRANSLATION_FONT_BY_LANG: Record<string, string> = {
  en: 'EB Garamond',
  hi: 'Noto Serif Devanagari',
  mr: 'Noto Serif Devanagari',
  sa: 'Noto Serif Devanagari',
  ta: 'Noto Serif Tamil',
  te: 'Noto Serif Telugu',
  kn: 'Noto Serif Kannada',
  ml: 'Noto Serif Malayalam',
  bn: 'Noto Serif Bengali',
  as: 'Noto Serif Bengali',
  gu: 'Noto Serif Gujarati',
  pa: 'Noto Serif Gurmukhi',
  or: 'Noto Serif Oriya',
};

/** Resolve the translation-line font for a language (EB Garamond fallback). */
export function translationFontForLang(lang: string): string {
  return TRANSLATION_FONT_BY_LANG[lang] ?? 'EB Garamond';
}
