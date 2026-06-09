import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CORE_PRELOADED_FONT_ASSETS,
  FONT_FAMILY_ASSETS,
} from '../../src/lib/font-assets';

const ROOT = resolve(__dirname, '..', '..');
const FONTS_CSS_PATH = resolve(ROOT, 'src', 'styles', 'fonts.css');
const BASE_LAYOUT_PATH = resolve(ROOT, 'src', 'layouts', 'BaseLayout.astro');

describe('font delivery wiring', () => {
  it('self-hosts every declared font face from /public/fonts without local() aliases', () => {
    const css = readFileSync(FONTS_CSS_PATH, 'utf8');

    expect(css.includes('local('), 'font delivery should not depend on local() lookups').toBe(
      false,
    );

    for (const { asset, family } of FONT_FAMILY_ASSETS) {
      expect(css).toContain(`font-family: "${family}"`);
      expect(css).toContain(`url("${asset}")`);
    }
  });

  it('preloads the core body and chrome fonts in BaseLayout', () => {
    const layout = readFileSync(BASE_LAYOUT_PATH, 'utf8');

    expect(layout).toContain('CORE_PRELOADED_FONT_ASSETS');
    // Roman + Italic (Source Serif 4) + Inter + Devanagari = 4 core fonts.
    // Italic was added to fix the home + verse-page LCP gating (see
    // `perf(fonts): preload italic variant`).
    expect(CORE_PRELOADED_FONT_ASSETS).toHaveLength(4);
    expect(CORE_PRELOADED_FONT_ASSETS).toContain(
      '/fonts/latin/source-serif-4-italic.woff2',
    );
    expect(layout).toContain('rel="preload"');
    expect(layout).toContain('as="font"');
  });
});
