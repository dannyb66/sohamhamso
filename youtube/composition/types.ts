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

// ─────────────────────────────────────────────────────────────────────────────
// Chapter composition (16:9 full-chapter videos — format 2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One verse segment on the Chapter timeline. ALL frame values are ABSOLUTE
 * composition frames (not Sequence-relative): `startFrame` is where the
 * segment's non-overlapping window begins, `narrationStartFrame` is where the
 * translation appears AND its narration starts. The 0.5s crossfade overlap is
 * a Chapter.tsx rendering concern — the timing map itself never overlaps, so
 * `startFrame / fps` is directly usable as a YouTube chapter timestamp.
 */
export type ChapterSegment = {
  verseNum: number;
  devanagari: string;
  iast: string;
  translation: string;
  startFrame: number;
  durationInFrames: number;
  narrationStartFrame: number;
  audioSrc: string | null;
};

export type ChapterProps = {
  textTitle: string; // IAST title, e.g. "Śivasūtrāṇi"
  textTitleDevanagari: string; // e.g. "शिवसूत्राणि"
  chapter: number;
  chapterName?: string | null; // traditional section name (unmeṣa) when present
  lang: string;
  langLabel: string; // e.g. "English"
  verseCount: number;
  preset: ShortPreset;
  translationFont: string;
  segments: ChapterSegment[];
  titleCardFrames: number;
  titleCardAudioSrc: string | null;
  outroFrames: number;
  outroUrl: string; // short human-readable URL, e.g. "sohamhamso.org/trika/siva-sutras/1"
  fps: number;
  durationInFrames: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Landscape (1920×1080) font-size buckets for the Chapter composition.
//
// Same length-calibrated pickSize approach as Short.tsx, re-derived for a
// ~1400px translation measure (vs ~660px portrait). They live HERE (pure, no
// remotion import) rather than in Chapter.tsx so unit tests can assert the
// 332-char worst-case translation fits CHAPTER_TRANSLATION_MAX_LINES without
// pulling the remotion runtime (Chapter.tsx calls loadFonts() at module load,
// which requires a browser FontFace environment).
// ─────────────────────────────────────────────────────────────────────────────

const pickSize = (len: number, steps: [number, number][], min: number): number => {
  for (const [maxLen, size] of steps) if (len <= maxLen) return size;
  return min;
};

/** Devanāgarī line size for the landscape verse stack. */
export const chapterDevFontSize = (len: number): number =>
  pickSize(
    len,
    [
      [16, 104],
      [30, 92],
      [48, 80],
      [70, 70],
    ],
    60,
  );

/** IAST line size for the landscape verse stack. */
export const chapterIastFontSize = (len: number): number =>
  pickSize(
    len,
    [
      [30, 56],
      [60, 50],
      [100, 44],
      [150, 40],
    ],
    36,
  );

/** Translation line size for the landscape verse stack (~1400px measure). */
export const chapterTranslationFontSize = (len: number): number =>
  pickSize(
    len,
    [
      [70, 54],
      [120, 48],
      [180, 44],
      [250, 40],
    ],
    36,
  );

/** Text measure (content width) of the landscape translation block, px. */
export const CHAPTER_TRANSLATION_MEASURE_PX = 1400;

/** Hard cap the worst-case (332-char) translation must fit within. */
export const CHAPTER_TRANSLATION_MAX_LINES = 6;

/**
 * Conservative wrapped-line-count estimate for EB Garamond body text:
 * average glyph advance ≈ 0.52em at weight 400 (measured against the
 * portrait worst case). Used by the unit suite to prove the landscape
 * buckets keep the longest corpus translation inside the safe area.
 */
export function estimateTranslationLineCount(
  text: string,
  fontSize: number,
  measurePx: number = CHAPTER_TRANSLATION_MEASURE_PX,
): number {
  const avgCharPx = 0.52 * fontSize;
  const charsPerLine = Math.max(1, Math.floor(measurePx / avgCharPx));
  return Math.max(1, Math.ceil(text.length / charsPerLine));
}
