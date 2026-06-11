/**
 * youtube/composition/Root.tsx
 *
 * Remotion composition registry. `registerRoot(RemotionRoot)` is called from
 * the bundle entry `entry.ts` (which @remotion/bundler requires as its entry
 * point); here we just register the single "Short" composition at vertical
 * 1080x1920 with the Siva Sutra 1.1 sample as default props.
 */
import type React from 'react';
import { Composition } from 'remotion';
import { type ShortProps, ShortVideo } from './Short';

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

export const SIVA_SUTRA_1_1: ShortProps = {
  textTitle: 'Śiva Sūtra',
  reference: '1.1',
  devanagari: 'चैतन्यमात्मा',
  iast: 'caitanyam ātmā',
  translation: 'Consciousness is the Self.',
  preset: { ...TRIKA_CLASSIC },
  audioSrc: null,
  audioStartFrame: SAMPLE_AUDIO_START_FRAME,
  fps: SAMPLE_FPS,
  durationInFrames: SAMPLE_DURATION_IN_FRAMES,
};

export const RemotionRoot: React.FC = () => {
  return (
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
  );
};

export default RemotionRoot;
