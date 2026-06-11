/**
 * forbidden-palette.test.ts
 *
 * The forbidden-color guard: saffron (#FF9933) and near-saffron hues inside
 * the ±15% RGB band are rejected; the actual Trika-classic background +
 * accent are allowed. `hexDistancePct` of a color against itself is 0.
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SAFFRON_HEX,
  hexDistancePct,
  isForbiddenColor,
  loadYoutubeConfig,
} from '../../../pipeline/youtube/config';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const CONFIG_PATH = resolve(REPO_ROOT, 'data', 'youtube-config.yaml');
const cfg = loadYoutubeConfig(CONFIG_PATH);

describe('SAFFRON_HEX', () => {
  it('is the BJP-flag saffron', () => {
    expect(SAFFRON_HEX).toBe('#FF9933');
  });
});

describe('isForbiddenColor', () => {
  it('rejects exact saffron #FF9933', () => {
    expect(isForbiddenColor(cfg, '#FF9933')).toBe(true);
  });

  it('rejects a near-saffron within the ±15% band (#FB8E2E)', () => {
    // sanity: the test color really is within 15% of saffron
    expect(hexDistancePct('#FB8E2E', SAFFRON_HEX)).toBeLessThanOrEqual(15);
    expect(isForbiddenColor(cfg, '#FB8E2E')).toBe(true);
  });

  it('allows the trika-classic background #0E1B2E', () => {
    expect(isForbiddenColor(cfg, '#0E1B2E')).toBe(false);
  });

  it('allows the trika-classic accent #C9A961', () => {
    expect(isForbiddenColor(cfg, '#C9A961')).toBe(false);
  });
});

describe('hexDistancePct', () => {
  it('is 0 for a color against itself', () => {
    expect(hexDistancePct(SAFFRON_HEX, SAFFRON_HEX)).toBe(0);
  });

  it('is symmetric', () => {
    expect(hexDistancePct('#0E1B2E', '#C9A961')).toBeCloseTo(
      hexDistancePct('#C9A961', '#0E1B2E'),
      10,
    );
  });
});
