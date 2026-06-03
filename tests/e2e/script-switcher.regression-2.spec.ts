// Regression: ISSUE-005 — verse-anatomy layout contract (user design 2026-06-01)
//
// Design intent (locked):
//   - Devanāgarī mode (default): line 1 = Devanāgarī verse, line 2 = IAST,
//     synonyms in English, translation in English.
//   - IAST mode: same line 1 + line 2 as default, synonyms + translation
//     in English. ("looks fine, all english" per user spec.)
//   - Any other Indic mode: line 1 = Devanāgarī (Sanskrit ORIGINAL stays
//     in source script), line 2 = transliteration into picked script,
//     synonyms + translation in matching language.
//
// Bug surfaced by user screenshots: line 1 was transliterating away from
// Devanāgarī when a non-default script was picked, and the script switcher
// did not drive the reader-language so Indic glosses stuck on whatever the
// user had last persisted (Kannada in the report).
//
// Fix: VerseAnatomy strips data-sa from .verse-devanagari (line 1 stays
// Devanāgarī forever) and ADDS data-sa to .verse-iast (line 2 now
// transliterates). ScriptSwitcher.applyScript uses an "effective" script
// where target='devanagari' maps to 'iast' (so Devanāgarī mode shows
// IAST on line 2, not Devanāgarī twice).

import { expect, test } from '@playwright/test';

// Devanāgarī LETTERS only (excludes dandas ।॥ at U+0964-0965 and
// numerals at U+0966-096F which Sanscript intentionally doesn't
// transliterate). Range U+0900 – U+0963 covers all consonant + vowel +
// vowel-sign codepoints in the block.
const DEVANAGARI_LETTERS = /[ऀ-ॣ]/;
const BENGALI_RANGE = /[ঀ-৿]/;
const TAMIL_RANGE = /[஀-௿]/;

test.describe('ISSUE-005 — verse-anatomy script layout contract', () => {
  test('default mode: line 1 Devanāgarī, line 2 IAST (Latin)', async ({ page }) => {
    await page.goto('/trika/siva-sutras/1/1');
    await page.evaluate(() => {
      localStorage.removeItem('sohamhamso:script');
      localStorage.removeItem('sohamhamso:reader-lang');
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    const line1 = await page.locator('.verse-devanagari').first().textContent();
    const line2 = await page.locator('.verse-iast').first().textContent();
    expect(line1).toMatch(DEVANAGARI_LETTERS);
    expect(line2).not.toMatch(DEVANAGARI_LETTERS);
    // IAST contains Latin letters with diacritics — minimum: a-z appears.
    expect(line2 ?? '').toMatch(/[a-zA-Z]/);
  });

  test('Bengali mode: line 1 stays Devanāgarī, line 2 becomes Bengali script', async ({ page }) => {
    await page.goto('/trika/siva-sutras/1/1');
    await page.evaluate(() => {
      localStorage.removeItem('sohamhamso:script');
      localStorage.removeItem('sohamhamso:reader-lang');
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    await page.locator('.script-switcher__trigger').first().click();
    const bengaliRow = page.locator('.script-switcher__row:has-text("Bengali")').first();
    if (!(await bengaliRow.count())) {
      test.info().annotations.push({ type: 'skip', description: 'Bengali row not present' });
      return;
    }
    await bengaliRow.click();
    await page.waitForTimeout(300);

    const line1 = await page.locator('.verse-devanagari').first().textContent();
    const line2 = await page.locator('.verse-iast').first().textContent();

    // Line 1 — the Sanskrit ORIGINAL — must still be Devanāgarī.
    expect(line1, 'line 1 must stay Devanāgarī').toMatch(DEVANAGARI_LETTERS);
    expect(line1, 'line 1 must NOT contain Bengali glyphs').not.toMatch(BENGALI_RANGE);

    // Line 2 — the transliteration line — must now be Bengali.
    expect(line2, 'line 2 must contain Bengali glyphs').toMatch(BENGALI_RANGE);
    expect(line2, 'line 2 must NOT still be Devanāgarī').not.toMatch(DEVANAGARI_LETTERS);
  });

  test('Tamil mode: line 1 stays Devanāgarī, line 2 becomes Tamil script', async ({ page }) => {
    await page.goto('/trika/siva-sutras/1/1');
    await page.evaluate(() => {
      localStorage.removeItem('sohamhamso:script');
      localStorage.removeItem('sohamhamso:reader-lang');
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    await page.locator('.script-switcher__trigger').first().click();
    const tamilRow = page.locator('.script-switcher__row:has-text("Tamil")').first();
    if (!(await tamilRow.count())) {
      test.info().annotations.push({ type: 'skip', description: 'Tamil row not present' });
      return;
    }
    await tamilRow.click();
    await page.waitForTimeout(300);

    const line1 = await page.locator('.verse-devanagari').first().textContent();
    const line2 = await page.locator('.verse-iast').first().textContent();

    expect(line1, 'line 1 must stay Devanāgarī').toMatch(DEVANAGARI_LETTERS);
    expect(line2, 'line 2 must contain Tamil glyphs').toMatch(TAMIL_RANGE);
  });

  test('Hindi mode: line 2 stays IAST (effective script = iast fallback)', async ({ page }) => {
    // Post-2026-06-01: the unified READING_MODES catalogue is lang-keyed,
    // so there is no standalone "Devanāgarī" row anymore — Hindi
    // (scriptId='devanagari', langCode='hi') and Marathi
    // (scriptId='devanagari', langCode='mr') both ride Devanāgarī.
    // The Devanāgarī → IAST line-2 fallback is the same regardless of
    // which Devanāgarī-bearing language is picked; this test exercises
    // it via Hindi. Reader-lang must end at 'hi' (not 'en' as in the
    // pre-catalogue build).
    await page.goto('/trika/siva-sutras/1/1');
    await page.evaluate(() => {
      localStorage.setItem('sohamhamso:script', 'bengali');
      localStorage.setItem('sohamhamso:reader-lang', 'bn');
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    await page.locator('.script-switcher__trigger').first().click();
    const hindiRow = page.locator('.script-switcher__row:has-text("Hindi")').first();
    if (!(await hindiRow.count())) {
      test.info().annotations.push({ type: 'skip', description: 'Hindi row not present' });
      return;
    }
    await hindiRow.click();
    await page.waitForTimeout(300);

    const line2 = await page.locator('.verse-iast').first().textContent();
    // Devanāgarī-bearing mode → line 2 must be IAST (Latin), NOT Devanāgarī.
    expect(line2 ?? '').toMatch(/[a-zA-Z]/);
    expect(line2 ?? '').not.toMatch(DEVANAGARI_LETTERS);
    expect(line2 ?? '').not.toMatch(BENGALI_RANGE);

    // The Hindi reading mode persists reader-lang='hi'.
    const readerLang = await page.evaluate(() => localStorage.getItem('sohamhamso:reader-lang'));
    expect(readerLang).toBe('hi');
  });
});
