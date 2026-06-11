/**
 * config-schema.test.ts
 *
 * `loadYoutubeConfig` parses the real `data/youtube-config.yaml`, the four
 * style presets exist, eligibility flags match the plan (Trika texts true;
 * VBT + Karpuradi false with a reason), and `getStylePreset` throws on an
 * unknown preset name.
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getStylePreset, getTextConfig, loadYoutubeConfig } from '../../../pipeline/youtube/config';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const CONFIG_PATH = resolve(REPO_ROOT, 'data', 'youtube-config.yaml');

const cfg = loadYoutubeConfig(CONFIG_PATH);

describe('loadYoutubeConfig', () => {
  it('parses data/youtube-config.yaml without throwing', () => {
    expect(cfg).toBeDefined();
    expect(cfg.texts).toBeDefined();
    expect(cfg.style_presets).toBeDefined();
  });

  it('defines the four style presets', () => {
    const names = Object.keys(cfg.style_presets).sort();
    expect(names).toEqual(
      ['shakta-kali', 'trika-classic', 'trika-pulse', 'trika-recognition'].sort(),
    );
    expect(Object.keys(cfg.style_presets)).toHaveLength(4);
  });

  it('marks siva-sutras / spanda-karikas / pratyabhijna-hrdayam youtube_eligible: true', () => {
    for (const slug of ['siva-sutras', 'spanda-karikas', 'pratyabhijna-hrdayam']) {
      const t = getTextConfig(cfg, slug);
      expect(t, `missing text config: ${slug}`).toBeDefined();
      expect(t!.youtube_eligible, `${slug} should be eligible`).toBe(true);
      expect(t!.min_translation_status).toBe('reviewed');
    }
  });

  it('marks VBT + Karpuradi youtube_eligible: false with a reason', () => {
    for (const slug of ['vijnana-bhairava-tantra', 'karpuradi-stotra']) {
      const t = getTextConfig(cfg, slug);
      expect(t, `missing text config: ${slug}`).toBeDefined();
      expect(t!.youtube_eligible, `${slug} should be ineligible`).toBe(false);
      expect(t!.reason, `${slug} needs a reason`).toBeTruthy();
      expect((t!.reason ?? '').length).toBeGreaterThan(0);
    }
  });

  it('routes each Trika text to its preset', () => {
    expect(getTextConfig(cfg, 'siva-sutras')!.style_preset).toBe('trika-classic');
    expect(getTextConfig(cfg, 'pratyabhijna-hrdayam')!.style_preset).toBe('trika-recognition');
    expect(getTextConfig(cfg, 'spanda-karikas')!.style_preset).toBe('trika-pulse');
  });

  it('getStylePreset resolves a known preset', () => {
    const p = getStylePreset(cfg, 'trika-classic');
    expect(p.bg).toBe('#0E1B2E');
    expect(p.accent).toBe('#C9A961');
    expect(p.text).toBe('#E8E4D8');
  });

  it('getStylePreset throws on an unknown preset', () => {
    expect(() => getStylePreset(cfg, 'no-such-preset')).toThrow(/Unknown style_preset/);
  });
});
