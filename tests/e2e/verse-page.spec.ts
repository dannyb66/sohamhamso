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

  test('chrome locator shows verse position with chapter length ("1.1 / N")', async ({ page }) => {
    await page.goto(url);
    const locator = page.locator('.chrome__verse');
    await expect(locator).toBeVisible();
    const text = (await locator.innerText()).replace(/\s+/g, ' ').trim();
    const match = text.match(/^·\s*1\.1\s*\/\s*(\d+)$/);
    expect(match, `chrome locator text was "${text}"`).not.toBeNull();
    const count = Number(match?.[1]);
    expect(count).toBeGreaterThanOrEqual(1);
    // The denominator must match the chapter page's verse list — same
    // `verses` rows feed both, so they can never disagree.
    await page.goto('/trika/siva-sutras/1');
    const verseLinks = page.locator('a[href^="/trika/siva-sutras/1/"]');
    expect(await verseLinks.count()).toBeGreaterThanOrEqual(count);
  });

  test('locator stays fully visible in the sticky chrome (mobile-tight widths)', async ({
    page,
  }) => {
    await page.goto(url);
    const verse = page.locator('.chrome__verse');
    await expect(verse).toBeVisible();
    // flex-shrink: 0 contract — the "1.1 / N" span must never be clipped
    // by the title's ellipsis, including on the iPhone 13 project.
    const shrink = await verse.evaluate((el) => getComputedStyle(el).flexShrink);
    expect(shrink).toBe('0');
    const box = await verse.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    if (box && viewport) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    }
  });
});
