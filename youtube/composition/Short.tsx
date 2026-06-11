/**
 * youtube/composition/Short.tsx
 *
 * Vertical 1080x1920 YouTube Short orchestrator (<150 lines).
 *
 * Receives the full `ShortProps` contract (see below) and composes the five
 * sub-components into a gentle fade-in stack:
 *   Devanagari (in) → IAST (in) → Translation (in), with a persistent Footer
 *   and optional narration <Audio>.
 *
 * No visual value is hardcoded — everything flows from `preset`. `remotion`
 * imports resolve only after the orchestrator installs deps.
 */
import type React from 'react';
import {
  AbsoluteFill,
  Audio,
  interpolate,
  Sequence,
  useCurrentFrame,
} from 'remotion';
import { Background } from './Background';
import { Devanagari } from './Devanagari';
import { loadFonts } from './fonts';
import { Footer } from './Footer';
import { Translation } from './Translation';
import { Transliteration } from './Transliteration';

// Register fonts at module load so glyphs are ready before first frame.
loadFonts();

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
  audioSrc: string | null; // narration file/URL; render silence if null
  audioStartFrame: number; // frame the English appears AND narration begins
  fps: number; // 30
  durationInFrames: number; // dynamic: leadIn + narration + tail (per verse)
};

/** Fade a value in over `dur` frames starting at `start`. */
function fadeIn(frame: number, start: number, dur = 18): number {
  return interpolate(frame, [start, start + dur], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
}

// Length-calibrated type sizing: translations across the Phase-1 corpus run
// ~60–332 chars, so a fixed size overflows the long ones into the footer.
// These buckets keep the tallest verse inside the safe area (verified by
// re-rendering the 332-char max). Short verses stay large.
const pickSize = (len: number, steps: [number, number][], min: number): number => {
  for (const [maxLen, size] of steps) if (len <= maxLen) return size;
  return min;
};
const devFontSize = (len: number): number =>
  pickSize(len, [[16, 128], [30, 110], [48, 94], [70, 80]], 68);
const iastFontSize = (len: number): number =>
  pickSize(len, [[30, 62], [60, 54], [100, 46], [150, 40]], 36);
const translationFontSize = (len: number): number =>
  pickSize(len, [[70, 54], [120, 48], [180, 42], [250, 36], [320, 32]], 28);

export const ShortVideo: React.FC<ShortProps> = ({
  textTitle,
  reference,
  devanagari,
  iast,
  translation,
  preset,
  audioSrc,
  audioStartFrame,
}) => {
  const frame = useCurrentFrame();

  // Staggered entrance keyed off audioStartFrame: Devanāgarī → IAST settle in
  // BEFORE the English, which fades in exactly as the narration begins.
  const devOpacity = fadeIn(frame, Math.max(0, audioStartFrame - 42));
  const iastOpacity = fadeIn(frame, Math.max(0, audioStartFrame - 24));
  const translationOpacity = fadeIn(frame, audioStartFrame);

  return (
    <AbsoluteFill>
      <Background bg={preset.bg} accent={preset.accent} />

      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          flexDirection: 'column',
          gap: 44,
          // Reserve a band at the bottom for the footer (and a top margin), so
          // the centered verse stack never collides with the footer strip.
          paddingTop: 90,
          paddingBottom: 220,
        }}
      >
        <Devanagari
          text={devanagari}
          font={preset.devanagariFont}
          color={preset.text}
          opacity={devOpacity}
          fontSize={devFontSize(devanagari.length)}
        />
        <Transliteration
          iast={iast}
          font={preset.headlineFont}
          color={preset.accent}
          opacity={iastOpacity}
          fontSize={iastFontSize(iast.length)}
        />
        <Translation
          translation={translation}
          font={preset.bodyFont}
          color={preset.text}
          opacity={translationOpacity}
          fontSize={translationFontSize(translation.length)}
        />
      </AbsoluteFill>

      <Footer
        textTitle={textTitle}
        reference={reference}
        footerLine={preset.footerLine}
        font={preset.bodyFont}
        accent={preset.accent}
      />

      {audioSrc ? (
        <Sequence from={audioStartFrame}>
          <Audio src={audioSrc} />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};

export default ShortVideo;
