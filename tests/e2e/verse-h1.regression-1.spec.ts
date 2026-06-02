// Regression: design audit 2026-06-01 #8 — verse pages lacked an <h1>.
// Screen-reader users land on the verse page with no primary heading
// landmark (only <h2> for the verse number rail). Fix: render a single
// visually-hidden <h1> containing "{text title} {chapter}.{verse}" inside
// <main>. The visible verse-number rendering inside VerseAnatomy is
// untouched.

import { expect, test } from '@playwright/test';

test.describe('audit 2026-06-01 #8 — verse page has exactly one h1', () => {
  test('Vijñāna Bhairava 1.47 exposes a single h1 with title + verse locator', async ({
    page,
  }) => {
    await page.goto('/trika/vijnana-bhairava-tantra/1/47');

    const h1Locator = page.locator('main h1');
    await expect(h1Locator).toHaveCount(1);

    // textContent (not innerText) — the h1 is visually-hidden via
    // clip-rect/position:absolute, so innerText returns "".
    const h1Text = ((await h1Locator.first().textContent()) ?? '').trim();
    // The h1 must contain the verse locator so screen readers know where
    // they are in the corpus. Text title varies (we accept any non-empty
    // prefix); the "1.47" suffix is the load-bearing assertion.
    expect(h1Text).toMatch(/1\.47$/);
    expect(h1Text.length).toBeGreaterThan('1.47'.length);
  });

  test('Śiva Sūtra 1.1 also has exactly one h1', async ({ page }) => {
    await page.goto('/trika/siva-sutras/1/1');
    const h1Locator = page.locator('main h1');
    await expect(h1Locator).toHaveCount(1);
    // textContent (not innerText) — the h1 is visually-hidden via
    // clip-rect/position:absolute, so innerText returns "".
    const h1Text = ((await h1Locator.first().textContent()) ?? '').trim();
    expect(h1Text).toMatch(/1\.1$/);
  });
});
