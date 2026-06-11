/**
 * golden-frame.test.ts
 *
 * LIGHT structural golden test for the Siva Sutra 1.1 default frame. A real
 * Remotion render needs the `remotion` runtime + Chromium (not installed in
 * the unit suite), so we assert the *props* that drive the frame instead:
 *   - Devanagari 'चैतन्यमात्मा' and IAST 'caitanyam ātmā' are present
 *   - the props JSON hashes to a stable digest (frame-input drift guard)
 *
 * Props are built via the pure `buildShortProps` mapper (the same path the
 * render-engine feeds Remotion), so we exercise the real snake→camel preset
 * mapping without importing youtube/composition/Root.tsx (which pulls the
 * `remotion` runtime).
 *
 * TODO: real frame-hash render gated on remotion install — render Siva Sutra
 * 1.1 to a PNG and hash the pixels under MOCK_ALL once deps land.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildShortProps } from '../../../pipeline/youtube/remotion-props';

const TRIKA_CLASSIC = {
  bg: '#0E1B2E',
  accent: '#C9A961',
  text: '#E8E4D8',
  headline_font: 'EB Garamond',
  body_font: 'EB Garamond',
  devanagari_font: 'Noto Serif Devanagari',
  footer_line: 'Trika Śaiva canon · sohamhamso.org',
  ornament: 'none',
};

const SIVA_1_1_PROPS = buildShortProps({
  textTitle: 'Śiva Sūtra',
  reference: '1.1',
  devanagari: 'चैतन्यमात्मा',
  iast: 'caitanyam ātmā',
  translation: 'Consciousness is the Self.',
  preset: TRIKA_CLASSIC,
  audioSrc: null,
});

describe('golden-frame — Siva Sutra 1.1 props', () => {
  it('contains the Devanagari चैतन्यमात्मा', () => {
    expect(SIVA_1_1_PROPS.devanagari).toBe('चैतन्यमात्मा');
  });

  it('contains the IAST caitanyam ātmā', () => {
    expect(SIVA_1_1_PROPS.iast).toBe('caitanyam ātmā');
  });

  it('uses the Trika-classic on-screen palette + fonts', () => {
    expect(SIVA_1_1_PROPS.preset.bg).toBe('#0E1B2E');
    expect(SIVA_1_1_PROPS.preset.accent).toBe('#C9A961');
    expect(SIVA_1_1_PROPS.preset.devanagariFont).toBe('Noto Serif Devanagari');
  });

  it('silent sample uses the 8s floor (240 frames @ 30fps) with audio at 1.5s', () => {
    expect(SIVA_1_1_PROPS.durationInFrames).toBe(240);
    expect(SIVA_1_1_PROPS.audioStartFrame).toBe(45);
  });

  it('hashes the props JSON to a stable digest', () => {
    const hash = createHash('sha256').update(JSON.stringify(SIVA_1_1_PROPS)).digest('hex');
    // Locked golden — bump deliberately if the frame contract changes.
    expect(hash).toMatchSnapshot();
  });
});
