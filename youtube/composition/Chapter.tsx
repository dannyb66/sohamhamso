/**
 * youtube/composition/Chapter.tsx
 *
 * Landscape 1920×1080 full-chapter orchestrator (format 2):
 *
 *   narrated TitleCard → one <Sequence> per verse (staggered Devanāgarī →
 *   IAST → translation fades, per-segment <Audio>) → OutroCard.
 *
 * Persistent chrome (design decision #10): `Background` + `Footer` mount
 * ONCE here at the root — never per segment — so nothing pops at the 45
 * verse boundaries of a long chapter. Only the footer reference text (and
 * the "Verse i of M" right slot) crossfades (~12 frames) per verse, and a
 * bottom gold hairline fills left→right segment-stepped (opacity 0.28 base
 * rule, 0.55 fill — manuscript register, not a loading bar).
 *
 * Inter-segment transition: 0.5s overlap crossfade — the outgoing verse
 * fades out across the incoming verse's first frames; the background never
 * blanks. The timing map in props is NON-overlapping (see
 * pipeline/youtube/chapter-props.ts frame-math contract); the overlap is
 * purely how this file renders it.
 *
 * Floored (min_seg_s) segments use stretch-choreography: the entrance
 * stagger expands to fill the pre-narration span, the tail becomes a slow
 * 2.5–3s fade, and the whole verse stack drifts scale 1.00→1.015 across the
 * segment (sub-perceptual; keeps long floors from reading as a freeze).
 *
 * Landscape geometry is passed to the shared Background/Footer/Translation
 * via their NEW optional props — their defaults remain the portrait values,
 * so the Short composition's output is untouched (TEMPLATE_VERSION cascade
 * guard; see template-version.test.ts).
 */
import type React from 'react';
import {
  AbsoluteFill,
  Audio,
  interpolate,
  Sequence,
  useCurrentFrame,
} from 'remotion';
import {
  CHAPTER_SEG_LEAD_IN_S,
  FLOOR_PAD_LEAD_SHARE,
} from '../../pipeline/youtube/chapter-props';
import { Background } from './Background';
import { Devanagari } from './Devanagari';
import { loadFonts } from './fonts';
import { Footer } from './Footer';
import { OutroCard } from './OutroCard';
import { TitleCard } from './TitleCard';
import { Translation } from './Translation';
import { Transliteration } from './Transliteration';
import {
  CHAPTER_TRANSLATION_MEASURE_PX,
  type ChapterProps,
  type ChapterSegment,
  chapterDevFontSize,
  chapterIastFontSize,
  chapterTranslationFontSize,
} from './types';

// Register fonts at module load so glyphs are ready before first frame.
loadFonts();

// ─────────────────────────────────────────────────────────────────────────────
// Landscape geometry (1920×1080). Purpose-built, not reused-portrait
// (design decision #11) — fed into the shared components as prop overrides.
// ─────────────────────────────────────────────────────────────────────────────
const LS = {
  ruleTop: 140,
  ruleBottom: 150,
  ruleInsetX: 240,
  footerPadding: '0 240px 64px 240px',
  translationMaxWidth: CHAPTER_TRANSLATION_MEASURE_PX, // 1400
  stackMaxWidth: 1600,
} as const;

/** 0.5s inter-segment crossfade (frames). */
const crossfadeFrames = (fps: number): number => Math.round(0.5 * fps);

/** ~12-frame footer reference crossfade half-window. */
const FOOTER_XFADE_HALF = 6;

/** Fade a value in over `dur` frames starting at `start`. */
function fadeIn(frame: number, start: number, dur = 18): number {
  return interpolate(frame, [start, start + dur], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

// ─────────────────────────────────────────────────────────────────────────────
// Verse segment
// ─────────────────────────────────────────────────────────────────────────────

type VerseSegmentProps = {
  seg: ChapterSegment;
  preset: ChapterProps['preset'];
  translationFont: string;
  fps: number;
  /** Frames this <Sequence> started BEFORE seg.startFrame (crossfade lead). */
  overlapBefore: number;
  /** Total frames of the enclosing <Sequence>. */
  sequenceFrames: number;
};

const VerseSegment: React.FC<VerseSegmentProps> = ({
  seg,
  preset,
  translationFont,
  fps,
  overlapBefore,
  sequenceFrames,
}) => {
  const frame = useCurrentFrame(); // relative to the enclosing <Sequence>

  // Narration offset within this sequence (absolute → sequence-relative).
  const narrRel = seg.narrationStartFrame - (seg.startFrame - overlapBefore);

  // Stretch-choreography: entrance beats sit at fixed FRACTIONS of the
  // pre-narration span, so a floored segment's padding stretches the stagger
  // instead of leaving a static hold (design decision #13).
  const devStart = Math.round(narrRel * 0.18);
  const iastStart = Math.round(narrRel * 0.5);
  const devOpacity = fadeIn(frame, devStart);
  const iastOpacity = fadeIn(frame, iastStart);
  const translationOpacity = fadeIn(frame, narrRel);

  // Tail: floored segments earn a slow 2.5–3s fade; natural segments use the
  // plain 0.5s crossfade. Derive the floor padding from the lead stretch
  // (lead share is FLOOR_PAD_LEAD_SHARE of the padding — see chapter-props).
  const leadBase = Math.round(CHAPTER_SEG_LEAD_IN_S * fps);
  const extraLead = Math.max(0, narrRel - overlapBefore - leadBase);
  const extraTail = Math.round((extraLead * (1 - FLOOR_PAD_LEAD_SHARE)) / FLOOR_PAD_LEAD_SHARE);
  const fadeOutFrames = Math.min(
    Math.round(3 * fps),
    Math.max(overlapBefore, crossfadeFrames(fps) + extraTail),
  );
  const fadeOut = interpolate(
    frame,
    [sequenceFrames - fadeOutFrames, sequenceFrames],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  // Sub-perceptual scale drift across the whole segment (1.00 → 1.015).
  const scale = interpolate(frame, [0, sequenceFrames], [1, 1.015], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        opacity: fadeOut,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 44,
          maxWidth: LS.stackMaxWidth,
          paddingTop: LS.ruleTop + 30,
          paddingBottom: LS.ruleBottom + 60,
          transform: `scale(${scale})`,
        }}
      >
        <Devanagari
          text={seg.devanagari}
          font={preset.devanagariFont}
          color={preset.text}
          opacity={devOpacity}
          fontSize={chapterDevFontSize(seg.devanagari.length)}
        />
        <Transliteration
          iast={seg.iast}
          font={preset.headlineFont}
          color={preset.accent}
          opacity={iastOpacity}
          fontSize={chapterIastFontSize(seg.iast.length)}
        />
        <Translation
          translation={seg.translation}
          font={translationFont}
          color={preset.text}
          opacity={translationOpacity}
          fontSize={chapterTranslationFontSize(seg.translation.length)}
          maxWidth={LS.translationMaxWidth}
        />
      </div>

      {seg.audioSrc ? (
        <Sequence from={narrRel}>
          <Audio src={seg.audioSrc} />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Progress hairline — overlays the Background's bottom rule (same geometry),
// filling left→right one step per verse at opacity 0.55 over the 0.28 base.
// ─────────────────────────────────────────────────────────────────────────────

type ProgressHairlineProps = {
  accent: string;
  segments: ChapterSegment[];
  titleCardFrames: number;
  outroStartFrame: number;
};

const ProgressHairline: React.FC<ProgressHairlineProps> = ({
  accent,
  segments,
  titleCardFrames,
  outroStartFrame,
}) => {
  const frame = useCurrentFrame();
  const total = segments.length;
  const fullWidth = 1920 - 2 * LS.ruleInsetX;

  let fraction = 0;
  if (total > 0 && frame >= titleCardFrames) {
    if (frame >= outroStartFrame) {
      fraction = 1;
    } else {
      // Index of the segment in play; each step eases in over 12 frames.
      let i = 0;
      for (let k = 0; k < total; k++) {
        if (frame >= segments[k].startFrame) i = k;
      }
      const t = clamp01((frame - segments[i].startFrame) / 12);
      fraction = (i + t) / total;
    }
  }

  return (
    <div
      style={{
        position: 'absolute',
        bottom: LS.ruleBottom,
        left: LS.ruleInsetX,
        width: Math.round(fullWidth * fraction),
        height: 2,
        backgroundColor: accent,
        opacity: 0.55,
      }}
    />
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────────────────────

export const ChapterVideo: React.FC<ChapterProps> = ({
  textTitle,
  textTitleDevanagari,
  chapter,
  chapterName,
  verseCount,
  preset,
  translationFont,
  segments,
  titleCardFrames,
  titleCardAudioSrc,
  outroFrames,
  outroUrl,
  fps,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const xfade = crossfadeFrames(fps);
  const outroStart = durationInFrames - outroFrames;

  // ── Persistent footer state ────────────────────────────────────────────
  // Reference + right slot follow the active region; the swap is hidden
  // inside a ~12-frame opacity dip centred on each boundary.
  let reference = '';
  let rightText = preset.footerLine;
  let active = -1;
  for (let k = 0; k < segments.length; k++) {
    if (frame >= segments[k].startFrame) active = k;
  }
  if (frame >= outroStart) {
    reference = `Chapter ${chapter}`;
  } else if (active >= 0) {
    reference = `${chapter}.${segments[active].verseNum}`;
    rightText = `Verse ${active + 1} of ${verseCount}`;
  }
  const boundaries: number[] = [
    titleCardFrames,
    ...segments.slice(1).map((s) => s.startFrame),
    outroStart,
  ];
  let refOpacity = 1;
  for (const b of boundaries) {
    refOpacity = Math.min(refOpacity, clamp01(Math.abs(frame - b) / FOOTER_XFADE_HALF));
  }
  // Footer chrome itself fades in on the title card's 4th beat (after the
  // Devanāgarī / IAST / chapter-line staggers — it IS the card's 4th line).
  const footerOpacity = fadeIn(frame, 60);

  return (
    <AbsoluteFill>
      <Background
        bg={preset.bg}
        accent={preset.accent}
        ruleTop={LS.ruleTop}
        ruleBottom={LS.ruleBottom}
        ruleInsetX={LS.ruleInsetX}
      />
      <ProgressHairline
        accent={preset.accent}
        segments={segments}
        titleCardFrames={titleCardFrames}
        outroStartFrame={outroStart}
      />

      {/* Title card (fades out across verse 1's crossfade lead). */}
      <Sequence from={0} durationInFrames={titleCardFrames}>
        <TitleCard
          textTitle={textTitle}
          textTitleDevanagari={textTitleDevanagari}
          chapter={chapter}
          chapterName={chapterName}
          verseCount={verseCount}
          preset={preset}
          frames={titleCardFrames}
          fadeOutFrames={xfade}
        />
      </Sequence>
      {titleCardAudioSrc ? (
        <Sequence from={0}>
          <Audio src={titleCardAudioSrc} />
        </Sequence>
      ) : null}

      {/* One sequence per verse, started `xfade` early so the incoming verse
          fades in under the outgoing one (background never blanks). */}
      {segments.map((seg) => {
        const overlapBefore = Math.min(xfade, seg.startFrame);
        const from = seg.startFrame - overlapBefore;
        const sequenceFrames = overlapBefore + seg.durationInFrames;
        return (
          <Sequence key={seg.verseNum} from={from} durationInFrames={sequenceFrames}>
            <VerseSegment
              seg={seg}
              preset={preset}
              translationFont={translationFont}
              fps={fps}
              overlapBefore={overlapBefore}
              sequenceFrames={sequenceFrames}
            />
          </Sequence>
        );
      })}

      {/* Outro (starts at the last verse boundary; fades itself in). */}
      <Sequence from={outroStart} durationInFrames={outroFrames}>
        <OutroCard outroUrl={outroUrl} preset={preset} />
      </Sequence>

      {/* Persistent chrome — mounted ONCE, on top. */}
      <div style={{ position: 'absolute', inset: 0, opacity: footerOpacity }}>
        <Footer
          textTitle={textTitle}
          reference={reference}
          footerLine={preset.footerLine}
          font={preset.bodyFont}
          accent={preset.accent}
          padding={LS.footerPadding}
          rightText={rightText}
          referenceOpacity={refOpacity}
        />
      </div>
    </AbsoluteFill>
  );
};

export default ChapterVideo;
