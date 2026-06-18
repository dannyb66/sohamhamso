/**
 * config-chapters.test.ts
 *
 * The `chapters:` block in data/youtube-config.yaml: zod accepts the real
 * config (M0 values: en-only, draft floor, uploads held), the typed
 * accessor returns it, and validation failures carry field PATHS plus a
 * remediation line (e.g. `chapters.encode: ...`, `chapters.min_seg_s:
 * expected positive number`) — never a raw zod issue dump.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { dump as yamlDump, load as yamlLoad } from 'js-yaml';
import { afterEach, describe, expect, it } from 'vitest';
import { getChaptersConfig, loadYoutubeConfig } from '../../../pipeline/youtube/config';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const CONFIG_PATH = resolve(REPO_ROOT, 'data', 'youtube-config.yaml');

const cfg = loadYoutubeConfig(CONFIG_PATH);

/** Clone the real config object, apply a mutation, write it to a temp yaml. */
let tmpDir: string | null = null;
function writeMutatedConfig(mutate: (c: Record<string, unknown>) => void): string {
  const clone = yamlLoad(yamlDump(yamlLoad(readFileSync(CONFIG_PATH, 'utf8')))) as Record<
    string,
    unknown
  >;
  mutate(clone);
  tmpDir = mkdtempSync(join(tmpdir(), 'yt-cfg-'));
  const path = join(tmpDir, 'youtube-config.yaml');
  writeFileSync(path, yamlDump(clone));
  return path;
}
afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  tmpDir = null;
});

describe('chapters block — real config', () => {
  it('parses with the M0 values', () => {
    expect(cfg.chapters).toEqual({
      langs: ['en'],
      fps: 30,
      title_card_s: 5,
      outro_s: 9,
      min_translation_status: 'draft',
      uploads_enabled: false,
      min_seg_s: 10,
      seg_lead_in_s: 1.2,
      seg_tail_s: 1.0,
      group_max_verses: 1,
      encode: 'cbr8',
    });
  });

  it('getChaptersConfig returns the typed block', () => {
    const chapters = getChaptersConfig(cfg);
    expect(chapters.encode).toBe('cbr8');
    expect(chapters.uploads_enabled).toBe(false);
  });

  it('every chapters.langs entry has a voices entry (cross-check invariant)', () => {
    for (const lang of cfg.chapters.langs) {
      expect(cfg.voices[lang], `voices.${lang} missing for chapters lang`).toBeDefined();
    }
  });
});

describe('chapters block — rejections carry field paths', () => {
  it('rejects a bad encode value with a chapters.encode-bearing message', () => {
    const path = writeMutatedConfig((c) => {
      (c.chapters as Record<string, unknown>).encode = 'vbr5';
    });
    expect(() => loadYoutubeConfig(path)).toThrow(/chapters\.encode/);
  });

  it('rejects a non-positive min_seg_s with path + remediation message', () => {
    const path = writeMutatedConfig((c) => {
      (c.chapters as Record<string, unknown>).min_seg_s = -1;
    });
    expect(() => loadYoutubeConfig(path)).toThrow(/chapters\.min_seg_s: expected positive number/);
  });

  it('rejects a bad min_translation_status with its path', () => {
    const path = writeMutatedConfig((c) => {
      (c.chapters as Record<string, unknown>).min_translation_status = 'approved';
    });
    expect(() => loadYoutubeConfig(path)).toThrow(/chapters\.min_translation_status/);
  });

  it('rejects a missing chapters block (root-level path)', () => {
    const path = writeMutatedConfig((c) => {
      Reflect.deleteProperty(c, 'chapters');
    });
    expect(() => loadYoutubeConfig(path)).toThrow(/chapters/);
  });

  it('the error includes the one-line remediation', () => {
    const path = writeMutatedConfig((c) => {
      (c.chapters as Record<string, unknown>).encode = 'vbr5';
    });
    expect(() => loadYoutubeConfig(path)).toThrow(/youtube-validate-config/);
  });
});
