import { expect, test } from '@playwright/test';

/**
 * Font-loading audit — guards the design contract that every script the
 * ScriptSwitcher offers actually has a dedicated webfont loaded. Without
 * this, scripts (Tamil, Bengali, …) silently fall back to system serif
 * and the project's typographic premise breaks.
 *
 * The test only checks that the Google Fonts <link rel="stylesheet">
 * href in the document head names each required family. Visual quality
 * still requires a human eyeball — but a missing family is caught here.
 */

const REQUIRED_FAMILIES = [
  // Latin + UI — were already loaded; assert anyway so a future "trim"
  // refactor cannot quietly drop them.
  'Source+Serif+4',
  'Inter',
  // Devanagari — Sanskrit body face.
  'Noto+Serif+Devanagari',
  // Eight Indic scripts driven by ScriptSwitcher. Assamese piggybacks on
  // Bengali, so 8 families cover the 9 non-Devanagari script options.
  'Noto+Serif+Tamil',
  'Noto+Serif+Telugu',
  'Noto+Serif+Bengali',
  'Noto+Serif+Kannada',
  'Noto+Serif+Malayalam',
  'Noto+Serif+Gujarati',
  'Noto+Serif+Gurmukhi',
  'Noto+Serif+Oriya',
];

test.describe('font loading', () => {
  test('homepage <link> references every required font family', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Collect every stylesheet link's href. Family names live as URL-encoded
    // tokens in the Google Fonts CSS2 query string.
    const hrefs = await page
      .locator('link[rel="stylesheet"]')
      .evaluateAll((els) => els.map((el) => (el as HTMLLinkElement).href));
    const joined = hrefs.join('\n');

    for (const family of REQUIRED_FAMILIES) {
      expect(
        joined,
        `expected <link rel="stylesheet"> to reference ${family} (joined hrefs: ${joined})`,
      ).toContain(family);
    }

    // font-display:swap is non-negotiable — never block paint on a webfont.
    expect(joined).toMatch(/display=swap/);
  });

  test('verse reader page also serves the full font stack', async ({ page }) => {
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
    const hrefs = await page
      .locator('link[rel="stylesheet"]')
      .evaluateAll((els) => els.map((el) => (el as HTMLLinkElement).href));
    const joined = hrefs.join('\n');
    for (const family of REQUIRED_FAMILIES) {
      expect(joined, `reader page missing ${family}`).toContain(family);
    }
  });
});
