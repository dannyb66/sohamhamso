/**
 * remotion-props.test.ts
 *
 * `buildShortProps` maps the config `StylePreset` (snake_case) into the
 * Remotion `ShortProps` (camelCase), passes audioSrc through, and DERIVES the
 * per-verse length from the narration via `computeTiming`
 * (leadIn + narration + tail, clamped to [MIN_TOTAL_S, MAX_TOTAL_S]).
 *
 * Note: remotion-props.ts imports `ShortProps` as a TYPE ONLY, so this
 * import never pulls the `remotion` runtime — buildShortProps is pure.
 */
import { describe, expect, it } from 'vitest';
import {
  LEAD_IN_S,
  MAX_TOTAL_S,
  MIN_TOTAL_S,
  TAIL_S,
  buildShortProps,
  computeTiming,
} from '../../../pipeline/youtube/remotion-props';

const PRESET = {
  bg: '#0E1B2E',
  accent: '#C9A961',
  text: '#E8E4D8',
  headline_font: 'EB Garamond',
  body_font: 'EB Garamond',
  devanagari_font: 'Noto Serif Devanagari',
  footer_line: 'Trika Śaiva canon · sohamhamso.org',
  ornament: 'none',
};

const BASE = {
  textTitle: 'Śiva Sūtra',
  reference: '1.1',
  devanagari: 'चैतन्यमात्मा',
  iast: 'caitanyam ātmā',
  translation: 'Consciousness is the Self.',
  preset: PRESET,
  audioSrc: null,
};

describe('buildShortProps', () => {
  const props = buildShortProps(BASE);

  it('maps snake_case preset keys to camelCase', () => {
    expect(props.preset.headlineFont).toBe('EB Garamond');
    expect(props.preset.bodyFont).toBe('EB Garamond');
    expect(props.preset.devanagariFont).toBe('Noto Serif Devanagari');
    expect(props.preset.footerLine).toBe('Trika Śaiva canon · sohamhamso.org');
  });

  it('passes through bg / accent / text unchanged', () => {
    expect(props.preset.bg).toBe('#0E1B2E');
    expect(props.preset.accent).toBe('#C9A961');
    expect(props.preset.text).toBe('#E8E4D8');
  });

  it('silent (no narration) falls back to the MIN_TOTAL_S floor', () => {
    expect(props.fps).toBe(30);
    expect(props.durationInFrames).toBe(MIN_TOTAL_S * 30); // 8s @ 30fps = 240
    expect(props.audioStartFrame).toBe(Math.round(LEAD_IN_S * 30)); // 45
  });

  it('derives duration from the narration length (leadIn + narration + tail)', () => {
    const p = buildShortProps({ ...BASE, audioDurationS: 10 });
    const expectedS = LEAD_IN_S + 10 + TAIL_S; // 13.3s
    expect(p.durationInFrames).toBe(Math.round(expectedS * 30)); // 399
    expect(p.audioStartFrame).toBe(45);
  });

  it('clamps to the YouTube Shorts max (3 min) for very long narration', () => {
    const p = buildShortProps({ ...BASE, audioDurationS: 600 });
    expect(p.durationInFrames).toBe(MAX_TOTAL_S * 30); // 180s @ 30fps = 5400
  });

  it('honors an explicit fps override (timing scales with fps)', () => {
    const p = buildShortProps({ ...BASE, fps: 60 });
    expect(p.audioStartFrame).toBe(Math.round(LEAD_IN_S * 60)); // 90
    expect(p.durationInFrames).toBe(MIN_TOTAL_S * 60); // 480
  });

  it('passes audioSrc through (null → null)', () => {
    expect(props.audioSrc).toBeNull();
    expect(buildShortProps({ ...BASE, audioSrc: 'narration.mp3' }).audioSrc).toBe('narration.mp3');
  });

  it('carries verse content fields verbatim', () => {
    expect(props.textTitle).toBe('Śiva Sūtra');
    expect(props.reference).toBe('1.1');
    expect(props.devanagari).toBe('चैतन्यमात्मा');
    expect(props.iast).toBe('caitanyam ātmā');
    expect(props.translation).toBe('Consciousness is the Self.');
  });
});

describe('computeTiming', () => {
  it('audio starts after the lead-in', () => {
    expect(computeTiming(5).audioStartFrame).toBe(Math.round(LEAD_IN_S * 30));
  });

  it('total = leadIn + narration + tail within the window', () => {
    const { durationInFrames } = computeTiming(20); // 1.5+20+1.8 = 23.3s
    expect(durationInFrames).toBe(Math.round((LEAD_IN_S + 20 + TAIL_S) * 30));
  });

  it('floors short verses to MIN_TOTAL_S', () => {
    expect(computeTiming(0.5).durationInFrames).toBe(MIN_TOTAL_S * 30);
  });

  it('caps long verses at MAX_TOTAL_S (180s Shorts limit)', () => {
    expect(computeTiming(999).durationInFrames).toBe(MAX_TOTAL_S * 30);
  });
});
