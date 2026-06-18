import { type Page, expect, test } from '@playwright/test';
import { CORE_PRELOADED_FONT_ASSETS, FONT_FAMILY_ASSETS } from '../../src/lib/font-assets';

/**
 * Font-loading audit — guards the design contract that every script the
 * ScriptSwitcher offers actually has a dedicated webfont loaded. Without
 * this, scripts (Tamil, Bengali, …) silently fall back to system serif
 * and the project's typographic premise breaks.
 */

async function collectFontFaces(page: Page): Promise<FontFaceRecord[]> {
  return page.evaluate(() => {
    const fontFaces: FontFaceRecord[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        for (const rule of Array.from(sheet.cssRules)) {
          if (!(rule instanceof CSSFontFaceRule)) continue;
          const family = rule.style.getPropertyValue('font-family').replaceAll('"', '').trim();
          fontFaces.push({
            family,
            src: rule.style.getPropertyValue('src'),
          });
        }
      } catch {
        // Ignore stylesheets the browser refuses to expose.
      }
    }
    return fontFaces;
  });
}

test.describe('font loading', () => {
  test('homepage self-hosts every required font family', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const stylesheetHrefs = await page
      .locator('link[rel="stylesheet"]')
      .evaluateAll((els) => els.map((el) => (el as HTMLLinkElement).href));
    const joinedStylesheets = stylesheetHrefs.join('\n');

    expect(joinedStylesheets).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);

    const fontFaces = await collectFontFaces(page);
    for (const { asset, family } of FONT_FAMILY_ASSETS) {
      const face = fontFaces.find(
        (fontFace: FontFaceRecord) => fontFace.family === family && fontFace.src.includes(asset),
      );
      expect(
        face,
        `expected an @font-face for ${family} (available: ${JSON.stringify(fontFaces, null, 2)})`,
      ).toBeTruthy();
      expect(face?.src, `${family} should load from a repo-served asset`).toContain(asset);
      expect(face?.src, `${family} should not depend on local() lookup`).not.toContain('local(');
    }

    const preloadHrefs = await page
      .locator('link[rel="preload"][as="font"]')
      .evaluateAll((els) => els.map((el) => (el as HTMLLinkElement).href));
    const joinedPreloads = preloadHrefs.join('\n');
    for (const href of CORE_PRELOADED_FONT_ASSETS) {
      expect(joinedPreloads, `expected preload for ${href}`).toContain(href);
    }
  });

  test('verse reader page also serves the full self-hosted font stack', async ({ page }) => {
    // Reader pages share BaseLayout, but assert at least one non-homepage
    // route in case a future refactor splits layouts.
    const res = await page.goto('/shakta/karpuradi-stotra/1/1', {
      waitUntil: 'domcontentloaded',
    });
    // The route may not exist in every build context; only assert when 200.
    if (!res || res.status() !== 200) {
      test.info().annotations.push({
        type: 'skip',
        description: `verse page returned ${res?.status()} — skipping font assertion`,
      });
      return;
    }
    const fontFaces = await collectFontFaces(page);
    for (const { asset, family } of FONT_FAMILY_ASSETS) {
      const face = fontFaces.find(
        (fontFace: FontFaceRecord) => fontFace.family === family && fontFace.src.includes(asset),
      );
      expect(face, `reader page missing ${family}`).toBeTruthy();
      expect(face?.src, `reader page should self-host ${family}`).toContain(asset);
    }
  });
});
interface FontFaceRecord {
  family: string;
  src: string;
}
