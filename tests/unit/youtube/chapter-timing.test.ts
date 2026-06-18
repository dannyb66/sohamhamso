/**
 * chapter-timing.test.ts
 *
 * The chapter frame-math contract (eng decision #18): every span is rounded
 * to INTEGER frames FIRST, then integers are summed — so
 *   titleCardFrames + Σ segment.durationInFrames + outroFrames
 * EXACTLY equals durationInFrames, even for a 163-verse (VBT-scale)
 * synthetic input where float-seconds summation would drift.
 *
 * Also covers: the 10s min_seg_s floor (stretch-choreography narration
 * placement), title-card narration extension, buildChapterProps mapping,
 * and the landscape font buckets against the 332-char worst-case corpus
 * translation (CHAPTER_TRANSLATION_MAX_LINES).
 */
import { describe, expect, it } from 'vitest';
import {
  CHAPTER_MIN_SEG_S,
  CHAPTER_OUTRO_S,
  CHAPTER_SEG_LEAD_IN_S,
  CHAPTER_SEG_TAIL_S,
  CHAPTER_TITLE_CARD_S,
  TITLE_NARRATION_PAD_S,
  buildChapterProps,
  computeChapterTiming,
} from '../../../pipeline/youtube/chapter-props';
import {
  CHAPTER_TRANSLATION_MAX_LINES,
  CHAPTER_TRANSLATION_MEASURE_PX,
  chapterDevFontSize,
  chapterIastFontSize,
  chapterTranslationFontSize,
  estimateTranslationLineCount,
} from '../../../youtube/composition/types';

const FPS = 30;

const DEFAULTS = {
  titleNarrationS: 3.2,
  fps: FPS,
  titleCardS: CHAPTER_TITLE_CARD_S,
  outroS: CHAPTER_OUTRO_S,
  minSegS: CHAPTER_MIN_SEG_S,
  segLeadInS: CHAPTER_SEG_LEAD_IN_S,
  segTailS: CHAPTER_SEG_TAIL_S,
};

/** Σ integer segment frames + title + outro must equal the total. */
function assertIntegerInvariant(narrationDurationsS: number[]): void {
  const t = computeChapterTiming({ ...DEFAULTS, narrationDurationsS });
  const segSum = t.segments.reduce((acc, s) => acc + s.durationInFrames, 0);
  expect(t.titleCardFrames + segSum + t.outroFrames).toBe(t.durationInFrames);
  for (const s of t.segments) {
    expect(Number.isInteger(s.startFrame)).toBe(true);
    expect(Number.isInteger(s.durationInFrames)).toBe(true);
    expect(Number.isInteger(s.narrationStartFrame)).toBe(true);
  }
}

describe('computeChapterTiming — integer-frame invariant', () => {
  it('holds for a typical 7-verse chapter (spanda ch2 shape)', () => {
    assertIntegerInvariant([8.3, 11.7, 9.02, 14.96, 7.5, 10.333, 12.08]);
  });

  it('holds for a 163-verse synthetic chapter (VBT-scale, drift stress)', () => {
    // Fractional durations chosen so float-seconds summation WOULD drift.
    const durations = Array.from({ length: 163 }, (_, i) => 2.37 + (i % 17) * 0.337 + i * 0.0113);
    assertIntegerInvariant(durations);
  });

  it('segments tile the timeline: startFrame is cumulative, no gaps/overlap', () => {
    const t = computeChapterTiming({
      ...DEFAULTS,
      narrationDurationsS: [5.1, 12.7, 3.3, 22.9],
    });
    let cursor = t.titleCardFrames;
    for (const s of t.segments) {
      expect(s.startFrame).toBe(cursor);
      cursor += s.durationInFrames;
    }
    expect(cursor + t.outroFrames).toBe(t.durationInFrames);
  });

  it('rounds each segment to frames FIRST (never sums float seconds)', () => {
    // Two 0.0167s-grain durations whose float sum rounds differently than
    // the sum of the individually-rounded frame counts.
    const a = 10.016; // natural 12.216s → 366.48 → 366 frames
    const b = 10.016;
    const t = computeChapterTiming({ ...DEFAULTS, narrationDurationsS: [a, b] });
    const perSeg = Math.round((CHAPTER_SEG_LEAD_IN_S + a + CHAPTER_SEG_TAIL_S) * FPS);
    expect(t.segments[0].durationInFrames).toBe(perSeg);
    expect(t.segments[1].durationInFrames).toBe(perSeg);
    expect(t.durationInFrames).toBe(t.titleCardFrames + 2 * perSeg + t.outroFrames);
  });
});

describe('computeChapterTiming — min_seg_s floor (pacing guard)', () => {
  it('floors a short sutra segment at min_seg_s', () => {
    const t = computeChapterTiming({ ...DEFAULTS, narrationDurationsS: [1.4] });
    expect(t.segments[0].durationInFrames).toBe(Math.round(CHAPTER_MIN_SEG_S * FPS)); // 300
  });

  it('does NOT floor a segment whose natural length exceeds the floor', () => {
    const n = 12.5;
    const t = computeChapterTiming({ ...DEFAULTS, narrationDurationsS: [n] });
    const natural = Math.round((CHAPTER_SEG_LEAD_IN_S + n + CHAPTER_SEG_TAIL_S) * FPS);
    expect(t.segments[0].durationInFrames).toBe(natural);
  });

  it('floored segment stretches the entrance: narration starts after the scaled lead', () => {
    const n = 1.4;
    const t = computeChapterTiming({ ...DEFAULTS, narrationDurationsS: [n] });
    const seg = t.segments[0];
    const baseLead = Math.round(CHAPTER_SEG_LEAD_IN_S * FPS);
    // Stretch-choreography: 60% of the floor padding lands before narration.
    const extraS = CHAPTER_MIN_SEG_S - (CHAPTER_SEG_LEAD_IN_S + n + CHAPTER_SEG_TAIL_S);
    const expected = seg.startFrame + Math.round((CHAPTER_SEG_LEAD_IN_S + extraS * 0.6) * FPS);
    expect(seg.narrationStartFrame).toBe(expected);
    expect(seg.narrationStartFrame).toBeGreaterThan(seg.startFrame + baseLead);
    // Narration + a slow tail (≥2.5s) still fit inside the floored segment.
    const narrationEnd = seg.narrationStartFrame + Math.round(n * FPS);
    expect(narrationEnd + Math.round(2.5 * FPS)).toBeLessThanOrEqual(
      seg.startFrame + seg.durationInFrames + Math.round(0.5 * FPS),
    );
  });

  it('unfloored segment keeps the plain lead-in before narration', () => {
    const t = computeChapterTiming({ ...DEFAULTS, narrationDurationsS: [20] });
    const seg = t.segments[0];
    expect(seg.narrationStartFrame).toBe(seg.startFrame + Math.round(CHAPTER_SEG_LEAD_IN_S * FPS));
  });
});

describe('computeChapterTiming — title card', () => {
  it('uses the configured floor when narration is short', () => {
    const t = computeChapterTiming({ ...DEFAULTS, titleNarrationS: 2, narrationDurationsS: [5] });
    expect(t.titleCardFrames).toBe(Math.round(CHAPTER_TITLE_CARD_S * FPS)); // 150
  });

  it('extends to narration + 1.0s hold when the narration outruns the floor', () => {
    const t = computeChapterTiming({ ...DEFAULTS, titleNarrationS: 7.3, narrationDurationsS: [5] });
    expect(t.titleCardFrames).toBe(Math.round((7.3 + TITLE_NARRATION_PAD_S) * FPS));
  });

  it('outro is the configured length in frames', () => {
    const t = computeChapterTiming({ ...DEFAULTS, narrationDurationsS: [5] });
    expect(t.outroFrames).toBe(Math.round(CHAPTER_OUTRO_S * FPS)); // 270
  });
});

describe('buildChapterProps', () => {
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

  const props = buildChapterProps({
    textTitle: 'Śivasūtrāṇi',
    textTitleDevanagari: 'शिवसूत्राणि',
    chapter: 1,
    lang: 'en',
    langLabel: 'English',
    preset: PRESET,
    outroUrl: 'sohamhamso.org/trika/siva-sutras/1',
    titleCardAudioSrc: 'data:audio/wav;base64,AAAA',
    titleNarrationS: 3,
    fps: FPS,
    verses: [
      {
        verseNum: 1,
        devanagari: 'चैतन्यमात्मा',
        iast: 'caitanyam ātmā',
        translation: 'Consciousness is the Self.',
        audioSrc: 'data:audio/wav;base64,BBBB',
        narrationDurationS: 2.1,
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

  it('maps the snake_case preset to camelCase (same contract as buildShortProps)', () => {
    expect(props.preset.headlineFont).toBe('EB Garamond');
    expect(props.preset.devanagariFont).toBe('Noto Serif Devanagari');
    expect(props.preset.footerLine).toBe('Trika Śaiva canon · sohamhamso.org');
  });

  it('carries content + audio into ordered segments and counts verses', () => {
    expect(props.verseCount).toBe(2);
    expect(props.segments[0].verseNum).toBe(1);
    expect(props.segments[0].audioSrc).toBe('data:audio/wav;base64,BBBB');
    expect(props.segments[1].audioSrc).toBeNull();
    expect(props.segments[1].devanagari).toBe('ज्ञानं बन्धः');
  });

  it('embeds a consistent timing map (integer-sum invariant)', () => {
    const segSum = props.segments.reduce((a, s) => a + s.durationInFrames, 0);
    expect(props.titleCardFrames + segSum + props.outroFrames).toBe(props.durationInFrames);
    expect(props.segments[0].startFrame).toBe(props.titleCardFrames);
  });

  it('defaults translationFont to EB Garamond and keeps chapterName null', () => {
    expect(props.translationFont).toBe('EB Garamond');
    expect(props.chapterName).toBeNull();
  });
});

describe('landscape font buckets — 332-char worst case fits the line cap', () => {
  // Longest English translation in the Phase-1 corpus is 332 chars (the
  // portrait buckets in Short.tsx were calibrated against the same verse).
  const WORST = 'x'.repeat(332);

  it('332-char translation stays within CHAPTER_TRANSLATION_MAX_LINES at ~1400px', () => {
    const size = chapterTranslationFontSize(WORST.length);
    const lines = estimateTranslationLineCount(WORST, size, CHAPTER_TRANSLATION_MEASURE_PX);
    expect(lines).toBeLessThanOrEqual(CHAPTER_TRANSLATION_MAX_LINES);
  });

  it('every translation bucket keeps its max-length text within the cap', () => {
    for (const len of [70, 120, 180, 250, 332]) {
      const size = chapterTranslationFontSize(len);
      expect(
        estimateTranslationLineCount('x'.repeat(len), size, CHAPTER_TRANSLATION_MEASURE_PX),
      ).toBeLessThanOrEqual(CHAPTER_TRANSLATION_MAX_LINES);
    }
  });

  it('buckets are monotonic — longer text never gets a larger size', () => {
    const lens = [10, 40, 80, 130, 200, 260, 332, 500];
    for (const f of [chapterDevFontSize, chapterIastFontSize, chapterTranslationFontSize]) {
      for (let i = 1; i < lens.length; i++) {
        expect(f(lens[i])).toBeLessThanOrEqual(f(lens[i - 1]));
      }
    }
  });
});
