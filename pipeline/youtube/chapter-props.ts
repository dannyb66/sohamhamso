/**
 * pipeline/youtube/chapter-props.ts
 *
 * Pure mapper + timing math for the full-chapter (16:9) composition —
 * the chapter-format sibling of `remotion-props.ts::buildShortProps`.
 *
 * FRAME MATH CONTRACT (eng review, decision #18/#26):
 *   - Round EACH span to integer frames FIRST, then sum integers — never
 *     sum float seconds and round once (a 163-verse chapter would drift).
 *   - title card  = max(titleCardS, titleNarrationS + 1.0s)        → frames
 *   - segment     = max(minSegS, segLeadInS + narration + segTailS) → frames
 *   - total       = titleCardFrames + Σ segmentFrames + outroFrames
 *   The integer-sum invariant is unit-tested with a 163-verse synthetic
 *   input (tests/unit/youtube/chapter-timing.test.ts).
 *
 * All frame values in the returned timing map are ABSOLUTE composition
 * frames; the 0.5s crossfade overlap between verse segments is purely a
 * Chapter.tsx rendering concern, so `startFrame / fps` is directly usable
 * as a YouTube chapter timestamp.
 *
 * Import-light: type-only imports — safe to import from node tests AND to
 * be pulled into the Remotion browser bundle. Pacing knob values come from
 * `data/youtube-config.yaml` `chapters:` at the call site; the DEFAULT_*
 * constants here are the documented fallbacks (same values).
 */

import type { ChapterProps, ChapterSegment } from '../../youtube/composition/types';
import type { StylePreset } from './config';

const DEFAULT_FPS = 30;

// ─────────────────────────────────────────────────────────────────────────────
// Pacing defaults — mirror data/youtube-config.yaml `chapters:`. The config is
// the source of truth for renders; these exist so the pure math is callable
// without config plumbing (tests, previews).
// ─────────────────────────────────────────────────────────────────────────────
export const CHAPTER_TITLE_CARD_S = 5;
export const CHAPTER_OUTRO_S = 9;
export const CHAPTER_MIN_SEG_S = 10;
export const CHAPTER_SEG_LEAD_IN_S = 1.2;
export const CHAPTER_SEG_TAIL_S = 1.0;
/** Hold after the title narration ends before the first verse. */
export const TITLE_NARRATION_PAD_S = 1.0;
/**
 * Share of a floored segment's padding placed BEFORE the narration
 * (stretch-choreography: the entrance stagger expands to fill it); the
 * remaining 40% extends the tail into a slow 2.5–3s fade.
 */
export const FLOOR_PAD_LEAD_SHARE = 0.6;

export interface ChapterTimingArgs {
  /** Measured per-verse narration lengths, seconds, in verse order. */
  narrationDurationsS: number[];
  /** Measured title-card narration length, seconds (0 = silent card). */
  titleNarrationS: number;
  fps: number;
  titleCardS: number;
  outroS: number;
  minSegS: number;
  segLeadInS: number;
  segTailS: number;
}

export interface ChapterSegmentTiming {
  startFrame: number;
  durationInFrames: number;
  narrationStartFrame: number;
}

export interface ChapterTiming {
  titleCardFrames: number;
  outroFrames: number;
  segments: ChapterSegmentTiming[];
  durationInFrames: number;
}

/** Derive the full chapter timing map from measured narration lengths. */
export function computeChapterTiming(args: ChapterTimingArgs): ChapterTiming {
  const { fps } = args;

  // Title card: extend past the configured floor when the narration needs it.
  const titleS = Math.max(
    args.titleCardS,
    Math.max(0, args.titleNarrationS) + TITLE_NARRATION_PAD_S,
  );
  const titleCardFrames = Math.round(titleS * fps);

  const outroFrames = Math.round(args.outroS * fps);

  const segments: ChapterSegmentTiming[] = [];
  let cursor = titleCardFrames;
  for (const raw of args.narrationDurationsS) {
    const narrationS = Math.max(0, raw);
    const naturalS = args.segLeadInS + narrationS + args.segTailS;
    const segS = Math.max(args.minSegS, naturalS);
    const durationInFrames = Math.round(segS * fps);
    // Floored segments: 60% of the padding stretches the entrance
    // choreography, 40% lengthens the tail fade (design decision #13).
    const extraS = segS - naturalS;
    const narrationStartFrame =
      cursor + Math.round((args.segLeadInS + extraS * FLOOR_PAD_LEAD_SHARE) * fps);
    segments.push({ startFrame: cursor, durationInFrames, narrationStartFrame });
    cursor += durationInFrames;
  }

  return {
    titleCardFrames,
    outroFrames,
    segments,
    durationInFrames: cursor + outroFrames,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Props mapper
// ─────────────────────────────────────────────────────────────────────────────

export interface ChapterVerseContent {
  verseNum: number;
  devanagari: string;
  iast: string;
  translation: string;
  /** Narration audio (data URL / staticFile path); null → silent segment. */
  audioSrc: string | null;
  /** Measured narration length, seconds (0 for silent). */
  narrationDurationS: number;
}

export interface ChapterPropsArgs {
  textTitle: string; // IAST title
  textTitleDevanagari: string;
  chapter: number;
  chapterName?: string | null;
  lang: string;
  langLabel: string;
  preset: StylePreset;
  /** Per-language script font for the translation lines (default EB Garamond). */
  translationFont?: string;
  outroUrl: string;
  verses: ChapterVerseContent[];
  titleCardAudioSrc: string | null;
  /** Measured title narration length, seconds (0/omitted = silent card). */
  titleNarrationS?: number;
  fps?: number;
  /** Pacing knobs (from `chapters:` config). Defaults = CHAPTER_* constants. */
  titleCardS?: number;
  outroS?: number;
  minSegS?: number;
  segLeadInS?: number;
  segTailS?: number;
}

/** Map resolved chapter content + measured narration into `ChapterProps`. */
export function buildChapterProps(a: ChapterPropsArgs): ChapterProps {
  const fps = a.fps ?? DEFAULT_FPS;
  const timing = computeChapterTiming({
    narrationDurationsS: a.verses.map((v) => v.narrationDurationS),
    titleNarrationS: a.titleNarrationS ?? 0,
    fps,
    titleCardS: a.titleCardS ?? CHAPTER_TITLE_CARD_S,
    outroS: a.outroS ?? CHAPTER_OUTRO_S,
    minSegS: a.minSegS ?? CHAPTER_MIN_SEG_S,
    segLeadInS: a.segLeadInS ?? CHAPTER_SEG_LEAD_IN_S,
    segTailS: a.segTailS ?? CHAPTER_SEG_TAIL_S,
  });

  const segments: ChapterSegment[] = a.verses.map((v, i) => ({
    verseNum: v.verseNum,
    devanagari: v.devanagari,
    iast: v.iast,
    translation: v.translation,
    startFrame: timing.segments[i].startFrame,
    durationInFrames: timing.segments[i].durationInFrames,
    narrationStartFrame: timing.segments[i].narrationStartFrame,
    audioSrc: v.audioSrc,
  }));

  return {
    textTitle: a.textTitle,
    textTitleDevanagari: a.textTitleDevanagari,
    chapter: a.chapter,
    chapterName: a.chapterName ?? null,
    lang: a.lang,
    langLabel: a.langLabel,
    verseCount: a.verses.length,
    preset: {
      bg: a.preset.bg,
      accent: a.preset.accent,
      text: a.preset.text,
      headlineFont: a.preset.headline_font,
      bodyFont: a.preset.body_font,
      devanagariFont: a.preset.devanagari_font,
      footerLine: a.preset.footer_line,
    },
    translationFont: a.translationFont ?? 'EB Garamond',
    segments,
    titleCardFrames: timing.titleCardFrames,
    titleCardAudioSrc: a.titleCardAudioSrc,
    outroFrames: timing.outroFrames,
    outroUrl: a.outroUrl,
    fps,
    durationInFrames: timing.durationInFrames,
  };
}
