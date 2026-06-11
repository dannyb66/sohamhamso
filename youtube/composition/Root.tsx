/**
 * youtube/composition/Root.tsx
 *
 * Remotion composition registry. `registerRoot(RemotionRoot)` is called from
 * the bundle entry `entry.ts` (which @remotion/bundler requires as its entry
 * point); here we register:
 *   - "Short"   — vertical 1080x1920, one verse (Siva Sutra 1.1 sample)
 *   - "Chapter" — landscape 1920x1080, full chapter (2-verse silent sample)
 * Real renders override the props via inputProps; the rendered length always
 * comes from calculateMetadata, which reads durationInFrames/fps from props.
 */
import type React from 'react';
import { Composition } from 'remotion';
import { buildChapterProps } from '../../pipeline/youtube/chapter-props';
import { ChapterVideo } from './Chapter';
import { type ShortProps, ShortVideo } from './Short';
import type { ChapterProps } from './types';

const SAMPLE_FPS = 30;
// Default/preview length for the silent sample (the 8s floor). Real renders
// override durationInFrames + audioStartFrame via inputProps; the actual
// rendered length comes from calculateMetadata below, derived per verse.
const SAMPLE_AUDIO_START_FRAME = Math.round(1.5 * SAMPLE_FPS); // 45
const SAMPLE_DURATION_IN_FRAMES = 8 * SAMPLE_FPS; // 240

const TRIKA_CLASSIC = {
  bg: '#0E1B2E',
  accent: '#C9A961',
  text: '#E8E4D8',
  headlineFont: 'EB Garamond',
  bodyFont: 'EB Garamond',
  devanagariFont: 'Noto Serif Devanagari',
  footerLine: 'Trika Śaiva canon · sohamhamso.org',
} as const;

// Snake-case twin for the pure props mapper (mirrors config.ts StylePreset).
const TRIKA_CLASSIC_SNAKE = {
  bg: '#0E1B2E',
  accent: '#C9A961',
  text: '#E8E4D8',
  headline_font: 'EB Garamond',
  body_font: 'EB Garamond',
  devanagari_font: 'Noto Serif Devanagari',
  footer_line: 'Trika Śaiva canon · sohamhamso.org',
  ornament: 'none',
};

export const SIVA_SUTRA_1_1: ShortProps = {
  textTitle: 'Śiva Sūtra',
  reference: '1.1',
  devanagari: 'चैतन्यमात्मा',
  iast: 'caitanyam ātmā',
  translation: 'Consciousness is the Self.',
  preset: { ...TRIKA_CLASSIC },
  translationFont: 'EB Garamond',
  audioSrc: null,
  audioStartFrame: SAMPLE_AUDIO_START_FRAME,
  fps: SAMPLE_FPS,
  durationInFrames: SAMPLE_DURATION_IN_FRAMES,
};

// Silent two-verse Chapter preview (Śiva Sūtras 1.1–1.2). Real renders pass
// full per-verse content + measured narration via inputProps; this exists so
// `remotion studio` shows the landscape layout without TTS.
export const SIVA_SUTRA_CH1_SAMPLE: ChapterProps = buildChapterProps({
  textTitle: 'Śivasūtrāṇi',
  textTitleDevanagari: 'शिवसूत्राणि',
  chapter: 1,
  chapterName: null,
  lang: 'en',
  langLabel: 'English',
  preset: TRIKA_CLASSIC_SNAKE,
  translationFont: 'EB Garamond',
  outroUrl: 'sohamhamso.org/trika/siva-sutras/1',
  titleCardAudioSrc: null,
  titleNarrationS: 0,
  fps: SAMPLE_FPS,
  verses: [
    {
      verseNum: 1,
      devanagari: 'चैतन्यमात्मा',
      iast: 'caitanyam ātmā',
      translation: 'Consciousness is the Self.',
      audioSrc: null,
      narrationDurationS: 0,
    },
    {
      verseNum: 2,
      devanagari: 'ज्ञानं बन्धः',
      iast: 'jñānaṃ bandhaḥ',
      translation: 'Limited knowledge is bondage.',
      audioSrc: null,
      narrationDurationS: 0,
    },
  ],
});

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Short"
        component={ShortVideo}
        durationInFrames={SAMPLE_DURATION_IN_FRAMES}
        fps={SAMPLE_FPS}
        width={1080}
        height={1920}
        defaultProps={SIVA_SUTRA_1_1}
        // Length is per-verse: take it (and fps) from the props the render
        // passes, so each video is exactly leadIn + narration + tail.
        calculateMetadata={({ props }) => ({
          durationInFrames: props.durationInFrames,
          fps: props.fps,
        })}
      />
      <Composition
        id="Chapter"
        component={ChapterVideo}
        durationInFrames={SIVA_SUTRA_CH1_SAMPLE.durationInFrames}
        fps={SAMPLE_FPS}
        width={1920}
        height={1080}
        defaultProps={SIVA_SUTRA_CH1_SAMPLE}
        // Length is per-chapter: title card + Σ verse segments + outro,
        // computed by computeChapterTiming and carried in the props.
        calculateMetadata={({ props }) => ({
          durationInFrames: props.durationInFrames,
          fps: props.fps,
        })}
      />
    </>
  );
};

export default RemotionRoot;
