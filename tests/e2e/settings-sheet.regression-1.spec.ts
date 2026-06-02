import { expect, test } from '@playwright/test';

/**
 * SettingsSheet regression — design audit 2026-06-01 (recommendations
 * #3 theme, #6 sizing, #15 focus-trap). Covers the three fixes:
 *
 *  1. `Auto` theme tile is present and writes `theme:'auto'` to the
 *     unified settings blob while leaving the legacy `sohamhamso:theme`
 *     key in sync with the *resolved* concrete theme. The pre-paint
 *     contract only understands light/sepia/dark/oled, never `auto`.
 *  2. Sheet sizing — at 375x667 (iPhone SE) the sheet height stays
 *     within 85dvh and the bottom row (Reset) is reachable via
 *     internal scroll, not page scroll. Body-scroll-lock pins
 *     `<body>` while the sheet is open and restores `scrollY` on close.
 *  3. Focus trap + restore — Escape closes the sheet AND moves focus
 *     back to the Aa trigger button. Tab from the last focusable
 *     wraps to the first; Shift+Tab from the first wraps to the last.
 */
test.describe('settings sheet — design audit 2026-06-01 regressions', () => {
  const VERSE_URL = '/trika/siva-sutras/1/1';
  const STORAGE_KEY = 'sohamhamso:settings';
  const LEGACY_THEME_KEY = 'sohamhamso:theme';
  const SETTINGS_DIALOG = '[role="dialog"][aria-labelledby="settings-sheet-title"]';

  test.beforeEach(async ({ page }) => {
    await page.goto(VERSE_URL);
    await page.evaluate(
      ([s, t]) => {
        localStorage.removeItem(s);
        localStorage.removeItem(t);
      },
      [STORAGE_KEY, LEGACY_THEME_KEY],
    );
  });

  // ── #3 Theme: Auto option ─────────────────────────────────────────
  test('Auto theme tile exists and stores `auto` in the unified settings blob', async ({
    page,
  }) => {
    await page.goto(VERSE_URL);
    await page.waitForLoadState('networkidle');

    // Force a deterministic system preference so the test runs the
    // same way on any machine — Auto must resolve, not just store.
    await page.emulateMedia({ colorScheme: 'dark' });

    await page.locator('[data-settings-trigger]').first().click();
    const sheet = page.locator(SETTINGS_DIALOG).first();
    await expect(sheet).toBeVisible();

    const auto = sheet.locator('.settings__theme', { hasText: 'Auto' }).first();
    await expect(auto).toBeVisible();
    await auto.click();

    // Auto must NOT bleed `auto` into the legacy key — BaseLayout's
    // pre-paint script only handles concrete themes.
    const stored = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
    const legacy = await page.evaluate((k) => localStorage.getItem(k), LEGACY_THEME_KEY);
    const parsed = JSON.parse(stored ?? '{}');
    expect(parsed.theme).toBe('auto');
    // Dark system → resolved to dark.
    expect(legacy).toBe('dark');
    const attr = await page.locator('html').getAttribute('data-theme');
    expect(attr).toBe('dark');

    // Flip the system to light; the matchMedia listener should
    // re-resolve and unset data-theme without the user touching the
    // sheet. Selector intent stays `auto` in the blob.
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => page.locator('html').getAttribute('data-theme')).toBeNull();
    const stored2 = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
    expect(JSON.parse(stored2 ?? '{}').theme).toBe('auto');
  });

  // ── #6 Sizing: 85dvh + internal scroll + body lock ────────────────
  test.describe('sizing + body-scroll-lock at iPhone-SE viewport', () => {
    test.use({ viewport: { width: 375, height: 667 } });

    test('sheet height stays within 85dvh and body becomes the scroll surface', async ({
      page,
    }) => {
      await page.goto(VERSE_URL);
      await page.waitForLoadState('networkidle');

      await page.locator('[data-settings-trigger]').first().click();
      const sheet = page.locator(SETTINGS_DIALOG).first();
      await expect(sheet).toBeVisible();

      const sizing = await page.evaluate(() => {
        const dialog = document.querySelector<HTMLElement>('.settings');
        const body = document.querySelector<HTMLElement>('.settings__body');
        const dRect = dialog?.getBoundingClientRect();
        return {
          dialogHeight: dRect?.height ?? 0,
          viewportHeight: window.innerHeight,
          bodyOverflowY: body ? getComputedStyle(body).overflowY : null,
          bodyScrollable: body ? body.scrollHeight > body.clientHeight : false,
        };
      });

      // Allow a small margin for sub-pixel rendering — the cap is 85%.
      expect(sizing.dialogHeight).toBeLessThanOrEqual(sizing.viewportHeight * 0.86);
      // Body, not dialog, is the scroll surface.
      expect(sizing.bodyOverflowY).toBe('auto');
      // The full settings form overflows the body at 667px tall, so
      // scroll must actually be available — that's the bug we shipped
      // a fix for.
      expect(sizing.bodyScrollable).toBe(true);

      // The Reset button (last row in the body) must be reachable via
      // internal scroll — i.e., it exists in the DOM and lives inside
      // the scrollable body container.
      const reset = sheet.locator('.settings__reset');
      await expect(reset).toBeAttached();
      await reset.scrollIntoViewIfNeeded();
      await expect(reset).toBeVisible();
    });

    test('opening locks <body>; closing restores scrollY exactly', async ({ page }) => {
      // Use a long-content verse page so window.scrollY can actually
      // move; siva-sutras 1.1 is too short to scroll on its own.
      await page.goto('/trika/vijnana-bhairava-tantra/1/47');
      await page.waitForLoadState('networkidle');
      // Give the SettingsSheet (client:idle) a beat to hydrate.
      await page.locator('[data-settings-trigger]').first().waitFor();

      await page.evaluate(() => window.scrollTo(0, 200));
      const before = await page.evaluate(() => window.scrollY);
      expect(before).toBeGreaterThan(0);

      await page.locator('[data-settings-trigger]').first().click();
      await expect(page.locator(SETTINGS_DIALOG).first()).toBeVisible();

      const lockedState = await page.evaluate(() => ({
        position: document.body.style.position,
        top: document.body.style.top,
        overflow: document.body.style.overflow,
      }));
      expect(lockedState.position).toBe('fixed');
      expect(lockedState.top).toBe(`-${before}px`);
      expect(lockedState.overflow).toBe('hidden');

      // Close via Escape and confirm body returns to its prior state
      // AND window.scrollY is restored exactly (the iOS-safe pattern).
      await page.keyboard.press('Escape');
      await expect(page.locator(SETTINGS_DIALOG)).toHaveCount(0);
      const afterState = await page.evaluate(() => ({
        position: document.body.style.position,
        overflow: document.body.style.overflow,
        scrollY: window.scrollY,
      }));
      expect(afterState.position).toBe('');
      expect(afterState.overflow).toBe('');
      expect(afterState.scrollY).toBe(before);
    });
  });

  // ── #15 Focus trap + restore ──────────────────────────────────────
  test('Escape closes the sheet AND restores focus to the trigger', async ({ page }) => {
    await page.goto(VERSE_URL);
    await page.waitForLoadState('networkidle');

    const trigger = page.locator('[data-settings-trigger]').first();
    // Focus the trigger via keyboard so document.activeElement is the
    // button BEFORE the sheet opens — that's what openSheet stashes.
    await trigger.focus();
    await page.keyboard.press('Enter');

    const sheet = page.locator(SETTINGS_DIALOG).first();
    await expect(sheet).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator(SETTINGS_DIALOG)).toHaveCount(0);

    const restoredToTrigger = await page.evaluate(() =>
      !!document.activeElement?.hasAttribute('data-settings-trigger'),
    );
    expect(restoredToTrigger).toBe(true);
  });

  test('Tab from last focusable wraps to first; Shift+Tab from first wraps to last', async ({
    page,
  }) => {
    await page.goto(VERSE_URL);
    await page.waitForLoadState('networkidle');

    await page.locator('[data-settings-trigger]').first().click();
    const sheet = page.locator(SETTINGS_DIALOG).first();
    await expect(sheet).toBeVisible();

    // Initial focus is the first focusable inside the sheet — the
    // close button. Shift+Tab must wrap to the Reset button (last).
    const initialClass = await page.evaluate(() => document.activeElement?.className ?? '');
    expect(initialClass).toContain('settings__close');

    await page.keyboard.press('Shift+Tab');
    const wrappedClass = await page.evaluate(() => document.activeElement?.className ?? '');
    expect(wrappedClass).toContain('settings__reset');

    // Tab from Reset must wrap back to the close button.
    await page.keyboard.press('Tab');
    const wrappedForward = await page.evaluate(() => document.activeElement?.className ?? '');
    expect(wrappedForward).toContain('settings__close');
  });
});
