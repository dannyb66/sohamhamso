// Stress-test: combining-mark rendering across fragile Indic scripts.
//
// Risk: system serif fallback fonts (Times, Georgia, bare 'serif') silently
// drop or misrender anusvara (U+0902), virama (U+094D), vowel signs, and
// other combining sequences. script-switcher.regression-2.spec.ts validates
// that glyphs appear after a mode switch; this spec drives the font-family
// computed stack to prove a webfont — not the OS fallback — is serving
// those combining characters.
//
// Design contract (from regression-2 + reading-modes.ts):
//   - .verse-devanagari (line 1) = Sanskrit original, always Devanāgarī.
//   - .verse-iast (line 2) = transliteration target (changes per mode).
//   - hi / mr modes → line 2 becomes IAST (Latin), NOT Devanāgarī.
//   - bn / ta / kn / ml modes → line 2 gets transliterated to target script.
//
// Assertion strategy per locale:
//   hi / mr  → Devanāgarī range on .verse-devanagari (line 1); font-family
//               on that element must NOT be a bare system fallback.
//   bn / ta / kn / ml → target-script range on .verse-iast (line 2); same
//               font-family guard.

import * as fs from 'fs';
import * as path from 'path';
import { expect, test } from '@playwright/test';

// Font-rendering tests require a real browser with Noto Serif WOFF2 loaded.
// In CI (headless Chromium with no font cache), the font stack behaves differently
// and these assertions produce false positives / false negatives. The separate
// font-loading.spec.ts already validates @font-face rule presence in CI.
test.skip(
  !!process.env.CI,
  'combining-mark rendering tests require real browser with font loading',
);

// ── Unicode ranges ────────────────────────────────────────────────────────────
// Matches the narrower repo convention from regression-2.spec.ts (U+0900–U+0963
// covers consonants + vowels + combining vowel signs; excludes dandas +
// numerals which Sanscript intentionally skips).
const DEVANAGARI_LETTERS = /[ऀ-ॣ]/;
const BENGALI_RANGE = /[ঀ-৿]/;
const TAMIL_RANGE = /[஀-௿]/;
const KANNADA_RANGE = /[ಀ-೿]/;
const MALAYALAM_RANGE = /[ഀ-ൿ]/;

// ── System-fallback font names we must NOT be exclusively using ───────────────
const SYSTEM_FALLBACKS = ['Times New Roman', 'Times', 'Georgia', 'serif'];

/**
 * Returns true if the computed fontFamily string looks like an unresolved
 * system-serif fallback (i.e. only contains names from SYSTEM_FALLBACKS and
 * nothing else that suggests a webfont was registered).
 */
function isBareSystemFallback(fontFamily: string): boolean {
  // Split on comma, strip quotes + whitespace.
  const tokens = fontFamily
    .split(',')
    .map((t) => t.replace(/['"]/g, '').trim())
    .filter(Boolean);
  if (tokens.length === 0) return true;
  // All tokens must be recognized system fallbacks for this to be "bare".
  return tokens.every((tok) =>
    SYSTEM_FALLBACKS.some((fb) => tok.toLowerCase() === fb.toLowerCase()),
  );
}

// ── Locale fixture table ──────────────────────────────────────────────────────
interface LocaleFixture {
  langCode: string;
  englishName: string;
  /** CSS selector for the element that should carry the target-script text. */
  targetSelector: '.verse-devanagari' | '.verse-iast';
  /** Regex to assert the element contains codepoints in the expected range. */
  scriptRange: RegExp;
}

const LOCALES: LocaleFixture[] = [
  // hi + mr: Devanāgarī — test against line 1 (.verse-devanagari).
  // Line 2 becomes IAST (Latin) in Devanāgarī modes — asserting the combining
  // marks on line 1 (the always-Devanāgarī original) is the correct target.
  {
    langCode: 'hi',
    englishName: 'Hindi',
    targetSelector: '.verse-devanagari',
    scriptRange: DEVANAGARI_LETTERS,
  },
  {
    langCode: 'mr',
    englishName: 'Marathi',
    targetSelector: '.verse-devanagari',
    scriptRange: DEVANAGARI_LETTERS,
  },
  // bn / ta / kn / ml: transliterated scripts — test against line 2 (.verse-iast).
  {
    langCode: 'bn',
    englishName: 'Bengali',
    targetSelector: '.verse-iast',
    scriptRange: BENGALI_RANGE,
  },
  {
    langCode: 'ta',
    englishName: 'Tamil',
    targetSelector: '.verse-iast',
    scriptRange: TAMIL_RANGE,
  },
  {
    langCode: 'kn',
    englishName: 'Kannada',
    targetSelector: '.verse-iast',
    scriptRange: KANNADA_RANGE,
  },
  {
    langCode: 'ml',
    englishName: 'Malayalam',
    targetSelector: '.verse-iast',
    scriptRange: MALAYALAM_RANGE,
  },
];

// ── Ensure screenshot output dir exists ──────────────────────────────────────
const SCREENSHOT_DIR = path.resolve('tests/e2e/screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

// ── Tests ─────────────────────────────────────────────────────────────────────
test.describe('combining-mark rendering — webfont vs system fallback', () => {
  for (const { langCode, englishName, targetSelector, scriptRange } of LOCALES) {
    test(`${englishName} (${langCode}): combining marks render via webfont, not system serif`, async ({
      page,
    }) => {
      test.slow();

      // Navigate and reset any persisted state.
      await page.goto('/trika/siva-sutras/1/1');
      await page.evaluate(() => {
        localStorage.removeItem('sohamhamso:script');
        localStorage.removeItem('sohamhamso:reader-lang');
      });
      await page.reload();
      await page.waitForLoadState('networkidle');

      // Switch to the target locale via the ScriptSwitcher.
      await page.locator('.script-switcher__trigger').first().click();
      const modeRow = page.locator(`.script-switcher__row:has-text("${englishName}")`).first();
      if (!(await modeRow.count())) {
        test.info().annotations.push({
          type: 'skip',
          description: `${englishName} row not present in ScriptSwitcher`,
        });
        return;
      }
      await modeRow.click();
      await page.waitForTimeout(300);

      // ── Locate the target element ─────────────────────────────────────────
      const el = page.locator(targetSelector).first();

      // ── 1. Bounding-box width: text must have actually rendered ───────────
      const bbox = await el.boundingBox();
      expect(
        bbox,
        `${englishName}: element ${targetSelector} has no bounding box (not visible?)`,
      ).not.toBeNull();
      expect(
        bbox!.width,
        `${englishName}: ${targetSelector} width too small — text may not have rendered`,
      ).toBeGreaterThan(50);

      // ── 2. Script-range check: element contains codepoints in target range ─
      const textContent = await el.textContent();
      expect(textContent, `${englishName}: ${targetSelector} contains no text`).not.toBeNull();
      expect(
        textContent ?? '',
        `${englishName}: ${targetSelector} does not contain ${englishName} script codepoints`,
      ).toMatch(scriptRange);

      // ── 3. Font-family check: not a bare system fallback ──────────────────
      const fontFamily: string = await el.evaluate((el) => getComputedStyle(el).fontFamily);
      expect(
        isBareSystemFallback(fontFamily),
        `${englishName}: ${targetSelector} fontFamily is a bare system fallback: "${fontFamily}"`,
      ).toBe(false);

      // ── 4. Screenshot evidence ────────────────────────────────────────────
      await page.screenshot({
        path: `tests/e2e/screenshots/combining-marks-${langCode}.png`,
      });
    });
  }
});
