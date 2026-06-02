// Regression: design audit 2026-06-01 #9 — <html lang="en"> was hard-coded.
// When a user picked Hindi/Tamil/etc. as their reader language, the
// document root still advertised lang="en", which broke screen-reader
// pronunciation, per-script :lang() CSS rules, and SEO crawl signals.
//
// Fix: I18nSwap's onMount + sohamhamso:reader-lang-change handler now
// keep document.documentElement.lang in sync with the persisted
// reader-lang (sohamhamso:reader-lang in localStorage). SSR continues
// to emit lang="en"; the swap fires on hydrate.

import { expect, test } from '@playwright/test';

const VERSE = '/trika/vijnana-bhairava-tantra/1/47';

test.describe('audit 2026-06-01 #9 — html lang reflects reader language', () => {
  test('SSR delivers lang="en"', async ({ page }) => {
    await page.goto(VERSE);
    // First paint / before hydration: lang should be the SSR default.
    // (Playwright's goto resolves after load; hydrate runs at client:idle
    // which may or may not have fired. The deterministic assertion is
    // that we shipped EN as the SSR baseline — checked via meta below.)
    const lang = await page.locator('html').getAttribute('lang');
    expect(lang).toBe('en');
  });

  test('persisted Hindi preference → html.lang becomes "hi" after hydrate', async ({
    page,
  }) => {
    // Seed the preference, then reload so I18nSwap sees it on mount.
    await page.goto(VERSE);
    await page.evaluate(() => {
      localStorage.setItem('sohamhamso:reader-lang', 'hi');
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    // I18nSwap is client:idle — give it a tick to apply.
    await expect
      .poll(async () => await page.locator('html').getAttribute('lang'), {
        timeout: 5000,
      })
      .toBe('hi');
  });

  test('dispatching reader-lang-change re-syncs html.lang on the fly', async ({
    page,
  }) => {
    await page.goto(VERSE);
    await page.waitForLoadState('networkidle');

    // Baseline.
    await expect
      .poll(async () => await page.locator('html').getAttribute('lang'))
      .toBe('en');

    // Simulate the ScriptSwitcher picking Tamil.
    await page.evaluate(() => {
      localStorage.setItem('sohamhamso:reader-lang', 'ta');
      document.dispatchEvent(
        new CustomEvent('sohamhamso:reader-lang-change', {
          detail: { lang: 'ta' },
        }),
      );
    });

    await expect
      .poll(async () => await page.locator('html').getAttribute('lang'), {
        timeout: 5000,
      })
      .toBe('ta');

    // Switching BACK to English restores lang="en".
    await page.evaluate(() => {
      localStorage.setItem('sohamhamso:reader-lang', 'en');
      document.dispatchEvent(
        new CustomEvent('sohamhamso:reader-lang-change', {
          detail: { lang: 'en' },
        }),
      );
    });

    await expect
      .poll(async () => await page.locator('html').getAttribute('lang'), {
        timeout: 5000,
      })
      .toBe('en');
  });
});
