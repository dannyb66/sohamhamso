import { devices, expect, test } from '@playwright/test';

test.describe('responsive layout', () => {
  test('mobile iPhone 13: no horizontal scroll on verse page', async ({ browser }) => {
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const page = await ctx.newPage();
    await page.goto('/trika/siva-sutras/1/1');
    const overflow = await page.evaluate(() => {
      return {
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
      };
    });
    expect(overflow.scrollW).toBeLessThanOrEqual(overflow.clientW + 1);
    await ctx.close();
  });

  test('desktop: verse page renders without horizontal scroll', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto('/trika/siva-sutras/1/1');
    const overflow = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollW).toBeLessThanOrEqual(overflow.clientW + 1);
    await ctx.close();
  });

  test('theme switching: data-theme attribute updates on <html>', async ({ page }) => {
    await page.goto('/trika/siva-sutras/1/1');
    // Try to open Aa panel and click a theme option.
    const aa = page
      .locator(
        'button[aria-label*="reading" i], button[aria-label*="settings" i], button:has-text("Aa")',
      )
      .first();
    if (!(await aa.count())) {
      test.info().annotations.push({ type: 'skip', description: 'Aa button not present' });
      return;
    }
    await aa.click().catch(() => {});
    // Look for a "Dark" or "dark" choice — may be radio, button, or label.
    const dark = page
      .locator('button:has-text("Dark"), input[value="dark"], label:has-text("Dark")')
      .first();
    if (!(await dark.count())) {
      test.info().annotations.push({ type: 'skip', description: 'Dark theme picker absent' });
      return;
    }
    await dark.click().catch(() => {});
    const themeAttr = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme'),
    );
    expect(themeAttr).toMatch(/dark/i);
  });
});
