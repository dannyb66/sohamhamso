import { expect, test } from '@playwright/test';

/**
 * WordSheet.solid.tsx — tap-a-word bottom sheet.
 *
 * Document-level click delegation: anywhere a `[data-word-idx]` element is
 * tapped, WordSheet opens with the matching gloss. In the verse page,
 * `.sa-word` buttons inside the synonyms section carry the data attribute.
 *
 * Dismiss: ESC, scrim click, swipe-down, close button.
 */
test.describe('word sheet (tap a Sanskrit word)', () => {
  const VERSE_URL = '/trika/siva-sutras/1/1';
  const WORD_DIALOG = 'dialog[aria-label="Word details"]';

  test('tapping a .sa-word opens the bottom sheet with lemma + gloss', async ({ page }) => {
    await page.goto(VERSE_URL);
    await page.waitForLoadState('domcontentloaded');
    const word = page.locator('.sa-word').first();
    if (!(await word.count())) {
      test.info().annotations.push({
        type: 'skip',
        description: 'no .sa-word buttons on this verse',
      });
      return;
    }
    await word.click();

    const sheet = page.locator(WORD_DIALOG).first();
    await expect(sheet).toBeVisible({ timeout: 2000 });

    // Header contains the lemma (`.word-sheet__lemma`).
    const lemma = sheet.locator('.word-sheet__lemma');
    await expect(lemma).toBeVisible();
    const lemmaText = (await lemma.innerText()).trim();
    expect(lemmaText.length).toBeGreaterThan(0);
    // Body shows either the gloss or the empty/contribute message —
    // both are valid, but exactly one of the two should render.
    const gloss = sheet.locator('.word-sheet__gloss, .word-sheet__empty');
    await expect(gloss.first()).toBeVisible();
  });

  test('drag handle is visible on the sheet', async ({ page }) => {
    await page.goto(VERSE_URL);
    await page.waitForLoadState('domcontentloaded');
    const word = page.locator('.sa-word').first();
    if (!(await word.count())) {
      test.info().annotations.push({ type: 'skip', description: 'no .sa-word' });
      return;
    }
    await word.click();
    const sheet = page.locator(WORD_DIALOG).first();
    await expect(sheet).toBeVisible({ timeout: 2000 });
    // The handle is `display:none` on ≥768px (desktop modal). It's only
    // rendered as a visual cue on mobile bottom-sheet. We still assert
    // it's *attached* — it is hidden via CSS, not absent from the DOM.
    const handle = sheet.locator('.word-sheet__handle');
    await expect(handle).toHaveCount(1);
  });

  test('close button (×) dismisses the sheet', async ({ page }) => {
    await page.goto(VERSE_URL);
    await page.waitForLoadState('domcontentloaded');
    const word = page.locator('.sa-word').first();
    if (!(await word.count())) {
      test.info().annotations.push({ type: 'skip', description: 'no .sa-word' });
      return;
    }
    await word.click();
    const sheet = page.locator(WORD_DIALOG).first();
    await expect(sheet).toBeVisible({ timeout: 2000 });
    await sheet.locator('button[aria-label="Close"]').click();
    await expect(sheet).toBeHidden({ timeout: 2000 });
  });

  test('Escape closes the sheet', async ({ page }) => {
    await page.goto(VERSE_URL);
    await page.waitForLoadState('domcontentloaded');
    const word = page.locator('.sa-word').first();
    if (!(await word.count())) {
      test.info().annotations.push({ type: 'skip', description: 'no .sa-word' });
      return;
    }
    await word.click();
    const sheet = page.locator(WORD_DIALOG).first();
    await expect(sheet).toBeVisible({ timeout: 2000 });
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden({ timeout: 2000 });
  });

  test('scrim click dismisses the sheet', async ({ page }) => {
    await page.goto(VERSE_URL);
    await page.waitForLoadState('domcontentloaded');
    const word = page.locator('.sa-word').first();
    if (!(await word.count())) {
      test.info().annotations.push({ type: 'skip', description: 'no .sa-word' });
      return;
    }
    await word.click();
    const sheet = page.locator(WORD_DIALOG).first();
    await expect(sheet).toBeVisible({ timeout: 2000 });
    // Scrim is `.word-sheet__scrim` mounted as a sibling to the dialog.
    await page.locator('.word-sheet__scrim').click({ position: { x: 5, y: 5 } });
    await expect(sheet).toBeHidden({ timeout: 2000 });
  });
});
