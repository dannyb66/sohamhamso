/**
 * youtube/composition/TitleCard.tsx
 *
 * Narrated opening card for the Chapter composition (design decision #9):
 * the same staggered-fade choreography as the verse segments so the card
 * teaches the rhythm —
 *   (1) text title in Devanāgarī (large)
 *   (2) IAST title in accent gold
 *   (3) "Chapter {N} · {M} verses" in the body font
 *       (+ traditional section name, e.g. an unmeṣa title, when present)
 *   (4) footer line — rendered by the PERSISTENT Footer mounted at the
 *       Chapter root (it fades in on this card's 4th beat), not here.
 *
 * The title narration <Audio> is also mounted at the Chapter root (from
 * frame 0) so this component stays purely visual.
 */
import type React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { Devanagari } from './Devanagari';
import { Transliteration } from './Transliteration';
import type { ShortPreset } from './types';

export type TitleCardProps = {
  textTitle: string; // IAST
  textTitleDevanagari: string;
  chapter: number;
  chapterName?: string | null;
  verseCount: number;
  preset: ShortPreset;
  /** Frames of the title window; the card fades out over the last `fadeOutFrames`. */
  frames: number;
  fadeOutFrames: number;
};

/** Fade a value in over `dur` frames starting at `start`. */
function fadeIn(frame: number, start: number, dur = 18): number {
  return interpolate(frame, [start, start + dur], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
}

export const TitleCard: React.FC<TitleCardProps> = ({
  textTitle,
  textTitleDevanagari,
  chapter,
  chapterName,
  verseCount,
  preset,
  frames,
  fadeOutFrames,
}) => {
  const frame = useCurrentFrame();

  // Beats spaced like the verse stagger (18-frame gaps) — the card teaches
  // the rhythm the verses then repeat. Beat 4 (footer line) lives at the
  // Chapter root.
  const devOpacity = fadeIn(frame, 6);
  const iastOpacity = fadeIn(frame, 24);
  const lineOpacity = fadeIn(frame, 42);

  // Crossfade out into verse 1 (the incoming segment overlaps these frames).
  const fadeOut = interpolate(frame, [frames - fadeOutFrames, frames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const verseWord = verseCount === 1 ? 'verse' : 'verses';

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        flexDirection: 'column',
        gap: 48,
        paddingTop: 120,
        paddingBottom: 180,
        opacity: fadeOut,
      }}
    >
      <Devanagari
        text={textTitleDevanagari}
        font={preset.devanagariFont}
        color={preset.text}
        opacity={devOpacity}
        fontSize={120}
      />
      <Transliteration
        iast={textTitle}
        font={preset.headlineFont}
        color={preset.accent}
        opacity={iastOpacity}
        fontSize={60}
      />
      <div
        style={{
          fontFamily: `"${preset.bodyFont}", serif`,
          fontSize: 42,
          letterSpacing: '0.04em',
          color: preset.text,
          textAlign: 'center',
          opacity: lineOpacity,
        }}
      >
        {chapterName ? (
          <div
            style={{
              fontStyle: 'italic',
              color: preset.accent,
              fontSize: 38,
              marginBottom: 18,
            }}
          >
            {chapterName}
          </div>
        ) : null}
        <div>
          Chapter {chapter} · {verseCount} {verseWord}
        </div>
      </div>
    </AbsoluteFill>
  );
};
