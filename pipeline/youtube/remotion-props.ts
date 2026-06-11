/**
 * pipeline/youtube/remotion-props.ts
 *
 * Pure mapper: config `StylePreset` (snake_case keys) + verse content →
 * the Remotion `ShortProps` contract (camelCase preset keys). Keeps the
 * snake↔camel translation in exactly one place so the render-engine and
 * composition never disagree.
 *
 * Import-light: only the two types. Unit-tested separately.
 */

import type { ShortProps } from '../../youtube/composition/types';
import type { StylePreset } from './config';

export interface ShortPropsArgs {
  textTitle: string;
  reference: string;
  devanagari: string;
  iast: string;
  translation: string;
  preset: StylePreset;
  audioSrc: string | null;
  /** Measured narration length (seconds). 0/omitted → silent → floor applies. */
  audioDurationS?: number;
  fps?: number;
}

const DEFAULT_FPS = 30;

// ─────────────────────────────────────────────────────────────────────────────
// Timing model — the video length is DERIVED from the narration, not fixed.
//   [0 .. LEAD_IN_S)        Devanāgarī → IAST → English settle in
//   audioStartFrame         English visible + narration starts (= LEAD_IN_S)
//   ... narration plays ...
//   + TAIL_S                hold after the voice ends so it never cuts
// Total is clamped to [MIN_TOTAL_S, MAX_TOTAL_S] so very short verses stay
// watchable and nothing exceeds the YouTube Shorts cap. All tunable.
//
// MAX_TOTAL_S = 180: YouTube Shorts allow up to 3 minutes for vertical video
// using ORIGINAL audio (our TTS narration — the 90s limit is copyrighted-music
// only). Capping at 180 guarantees Short classification and ensures we never
// truncate a long verse's narration.
// ─────────────────────────────────────────────────────────────────────────────
export const LEAD_IN_S = 1.5;
export const TAIL_S = 1.8;
export const MIN_TOTAL_S = 8;
export const MAX_TOTAL_S = 180;

/** Derive frame timings from the measured narration length. */
export function computeTiming(
  audioDurationS: number,
  fps = DEFAULT_FPS,
): { audioStartFrame: number; durationInFrames: number } {
  const audioStartFrame = Math.round(LEAD_IN_S * fps);
  const rawS = LEAD_IN_S + Math.max(0, audioDurationS) + TAIL_S;
  const totalS = Math.min(MAX_TOTAL_S, Math.max(MIN_TOTAL_S, rawS));
  return { audioStartFrame, durationInFrames: Math.round(totalS * fps) };
}

/** Map a config preset + verse content into the Remotion `ShortProps`. */
export function buildShortProps(a: ShortPropsArgs): ShortProps {
  const fps = a.fps ?? DEFAULT_FPS;
  const { audioStartFrame, durationInFrames } = computeTiming(a.audioDurationS ?? 0, fps);
  return {
    textTitle: a.textTitle,
    reference: a.reference,
    devanagari: a.devanagari,
    iast: a.iast,
    translation: a.translation,
    preset: {
      bg: a.preset.bg,
      accent: a.preset.accent,
      text: a.preset.text,
      headlineFont: a.preset.headline_font,
      bodyFont: a.preset.body_font,
      devanagariFont: a.preset.devanagari_font,
      footerLine: a.preset.footer_line,
    },
    audioSrc: a.audioSrc,
    audioStartFrame,
    fps,
    durationInFrames,
  };
}
