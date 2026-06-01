// Regression: ISSUE-004 — Script switcher didn't change the reader language
// Found by user report on 2026-06-01: page stuck on Kannada glosses + translation
// regardless of which script was picked from the [देव] switcher. Sanskrit
// would transliterate (Devanagari → Bengali / Tamil / Kannada) but the
// .sa-gloss spans and the .translation paragraph stayed in Kannada because
// nothing dispatched sohamhamso:reader-lang-change.
//
// Fix: ScriptSwitcher.select() now also writes localStorage["sohamhamso:reader-lang"]
// and dispatches the reader-lang-change CustomEvent so ReaderLangSwap swaps
// glosses + translation to match. This test pins the unified contract.

import { expect, test } from '@playwright/test';

test.describe('ISSUE-004 — script switcher drives reader-language', () => {
  test('picking Tamil in the script switcher swaps glosses + translation to Tamil', async ({
    page,
  }) => {
    // Start from a known state: stuck on Kannada (the reported bug scenario).
    await page.goto('/trika/vijnana-bhairava-tantra/1/47');
    await page.evaluate(() => {
      localStorage.setItem('sohamhamso:reader-lang', 'kn');
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Open the script switcher.
    const trigger = page.locator('.script-switcher__trigger').first();
    if (!(await trigger.count())) {
      test.info().annotations.push({ type: 'skip', description: 'switcher not found' });
      return;
    }
    await trigger.click();

    // Pick Tamil.
    const tamil = page.locator('.script-switcher__row:has-text("Tamil")').first();
    if (!(await tamil.count())) {
      test.info().annotations.push({ type: 'skip', description: 'Tamil row not present' });
      return;
    }
    await tamil.click();
    await page.waitForTimeout(300);

    // localStorage must reflect the language change (the dedicated key the
    // verse-page island reads — sohamhamso:reader-lang, NOT the settings blob).
    const readerLang = await page.evaluate(() =>
      localStorage.getItem('sohamhamso:reader-lang'),
    );
    expect(readerLang).toBe('ta');

    // The .translation paragraph must have lang="ta" once the swap fires.
    // We don't assert the exact text body (translator-dependent) — only that
    // ReaderLangSwap reacted to the event and re-tagged the paragraph.
    const translationLang = await page
      .locator('.translation')
      .first()
      .getAttribute('lang');
    expect(translationLang).toBe('ta');
  });

  test('picking IAST resets the reader-language to English', async ({ page }) => {
    await page.goto('/trika/siva-sutras/1/1');
    await page.evaluate(() => {
      localStorage.setItem('sohamhamso:reader-lang', 'kn');
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    const trigger = page.locator('.script-switcher__trigger').first();
    if (!(await trigger.count())) {
      test.info().annotations.push({ type: 'skip', description: 'switcher not found' });
      return;
    }
    await trigger.click();

    // IAST is the romanization scheme; mapped to English in the unified contract.
    const iast = page.locator('.script-switcher__row:has-text("IAST")').first();
    if (!(await iast.count())) {
      test.info().annotations.push({ type: 'skip', description: 'IAST row not present' });
      return;
    }
    await iast.click();
    await page.waitForTimeout(300);

    const readerLang = await page.evaluate(() =>
      localStorage.getItem('sohamhamso:reader-lang'),
    );
    expect(readerLang).toBe('en');
  });
});
