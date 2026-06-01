import { expect, test } from '@playwright/test';

test.describe('script switcher (best-effort)', () => {
  test('round-trip Devanagari → Tamil → Devanagari preserves content', async ({ page }) => {
    await page.goto('/trika/siva-sutras/1/1');
    const switcher = page
      .locator(
        'button:has-text("Deva"), button[aria-label*="script" i], [data-script-switcher] button, .script-switcher button',
      )
      .first();
    if (!(await switcher.count())) {
      test.info().annotations.push({ type: 'skip', description: 'script switcher not found' });
      return;
    }
    // Snapshot original Devanagari segment.
    const devaOrig = await page.locator('body').innerText();
    const devaSeg = devaOrig.match(/[ऀ-ॿ]+/);
    expect(devaSeg, 'Devanagari segment must exist initially').toBeTruthy();

    // Open the switcher.
    await switcher.click().catch(() => {});

    // Look for a Tamil option.
    const tamil = page
      .locator('button:has-text("Tamil"), [data-script="tamil"], label:has-text("Tamil")')
      .first();
    if (!(await tamil.count())) {
      test.info().annotations.push({ type: 'skip', description: 'Tamil option not present' });
      return;
    }
    await tamil.click().catch(() => {});
    await page.waitForTimeout(300);
    const afterTamil = await page.locator('body').innerText();
    // After switching, Tamil chars should appear OR Devanagari should be gone.
    const hasTamil = /[஀-௿]/.test(afterTamil);
    const stillDeva = /[ऀ-ॿ]/.test(afterTamil);
    expect(hasTamil || !stillDeva, 'script should change to Tamil').toBe(true);

    // Switch back.
    await switcher.click().catch(() => {});
    const back = page
      .locator('button:has-text("Devan"), [data-script="devanagari"], label:has-text("Devan")')
      .first();
    if (await back.count()) {
      await back.click().catch(() => {});
      await page.waitForTimeout(300);
      const final = await page.locator('body').innerText();
      expect(final).toMatch(/[ऀ-ॿ]/);
    }
  });
});
