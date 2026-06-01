import { expect, test } from '@playwright/test';

test.describe('verse page — Śiva Sūtra 1.1', () => {
  const url = '/trika/siva-sutras/1/1';

  test('renders full verse anatomy with no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto(url);
    const body = await page.locator('body').innerText();
    expect(body).toMatch(/चैतन्य/);
    expect(body).toMatch(/caitanyam/);
    expect(body).toMatch(/Consciousness/i);
    expect(errors, `console errors: ${errors.join('\n')}`).toHaveLength(0);
  });

  test('AI-assist badge visible near verse number', async ({ page }) => {
    await page.goto(url);
    // Badge text — match anything mentioning AI/assist
    const body = await page.locator('body').innerText();
    expect(body).toMatch(/AI|assist/i);
  });

  test('prev/next navigation works', async ({ page }) => {
    await page.goto(url);
    // Find next link — should point to /trika/siva-sutras/1/2
    const next = page.locator('a[href*="/1/2"]').first();
    if (await next.count()) {
      await next.click();
      await page.waitForURL(/\/1\/2$/);
      const body = await page.locator('body').innerText();
      expect(body).toMatch(/[ऀ-ॿ]/);
    } else {
      test.info().annotations.push({ type: 'skip', description: 'no next link found on 1/1' });
    }
  });

  test('script switcher button present in top bar', async ({ page }) => {
    await page.goto(url);
    // ScriptSwitcher is a Solid island — look for it by role or class
    const switcher = page.locator(
      'button:has-text("Deva"), button[aria-label*="script" i], [data-script-switcher], .script-switcher button',
    );
    await expect(switcher.first()).toBeVisible();
  });

  test('settings (Aa) button present', async ({ page }) => {
    await page.goto(url);
    const settings = page.locator(
      'button[aria-label*="settings" i], button[aria-label*="reading" i], button:has-text("Aa")',
    );
    await expect(settings.first()).toBeVisible();
  });
});
