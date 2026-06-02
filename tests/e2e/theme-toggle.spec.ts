import { expect, test } from '@playwright/test';

/**
 * Theme toggle (Masthead) — one-tap light↔dark switch.
 *
 * Contract:
 *   - Button `[data-theme-toggle]` lives in the Masthead, between search
 *     and the language picker.
 *   - Click toggles `data-theme` on <html> between "dark" and unset.
 *     If currently `oled` or `dark` → goes to light (no attribute);
 *     otherwise → "dark".
 *   - Persists to BOTH `localStorage["sohamhamso:theme"]` (the legacy key
 *     read by BaseLayout's pre-paint script) AND
 *     `localStorage["sohamhamso:settings"]` (the unified blob read by
 *     SettingsSheet on mount), so opening Settings later does not
 *     silently revert the toggle's pick.
 *   - Survives reload — BaseLayout pre-paint applies the saved attribute
 *     before first paint, so no flash-of-wrong-theme.
 *
 * Also tested elsewhere (settings-sheet.spec.ts):
 *   - SettingsSheet's 4-way picker still writes data-theme.
 */
test.describe('masthead theme toggle', () => {
  const HOME_URL = '/';
  const THEME_KEY = 'sohamhamso:theme';
  const SETTINGS_KEY = 'sohamhamso:settings';

  test.beforeEach(async ({ page }) => {
    await page.goto(HOME_URL);
    await page.evaluate(
      ([t, s]) => {
        localStorage.removeItem(t);
        localStorage.removeItem(s);
      },
      [THEME_KEY, SETTINGS_KEY],
    );
  });

  test('toggle button is present in the masthead', async ({ page }) => {
    await page.goto(HOME_URL);
    await expect(page.locator('[data-theme-toggle]')).toBeVisible();
  });

  test('click flips data-theme to "dark" and persists both keys', async ({ page }) => {
    await page.goto(HOME_URL);
    // Force a known starting state (no saved theme, no OS dark hint).
    await page.evaluate(() => {
      document.documentElement.removeAttribute('data-theme');
    });
    await page.locator('[data-theme-toggle]').click();

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    const saved = await page.evaluate((k) => localStorage.getItem(k), THEME_KEY);
    expect(saved).toBe('dark');

    const blob = await page.evaluate((k) => localStorage.getItem(k), SETTINGS_KEY);
    expect(blob).not.toBeNull();
    const parsed = JSON.parse(blob!);
    expect(parsed.theme).toBe('dark');
  });

  test('second click flips back to light (no data-theme attribute)', async ({ page }) => {
    await page.goto(HOME_URL);
    await page.evaluate(() => {
      document.documentElement.removeAttribute('data-theme');
    });
    const btn = page.locator('[data-theme-toggle]');
    await btn.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await btn.click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/);

    const saved = await page.evaluate((k) => localStorage.getItem(k), THEME_KEY);
    expect(saved).toBeNull();
  });

  test('dark theme survives a reload (pre-paint cascade)', async ({ page }) => {
    await page.goto(HOME_URL);
    await page.evaluate(() => {
      document.documentElement.removeAttribute('data-theme');
    });
    await page.locator('[data-theme-toggle]').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.reload();
    // Pre-paint script applies the attribute before first paint.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('toggle does NOT navigate away from the current page', async ({ page }) => {
    await page.goto(HOME_URL);
    const before = page.url();
    await page.locator('[data-theme-toggle]').click();
    // The button is a <button type="button"> inside a banner; clicking must
    // not trigger a hash change or navigation.
    expect(page.url()).toBe(before);
  });

  test('background swatch cascades to var(--color-bg) in dark', async ({ page }) => {
    await page.goto(HOME_URL);
    await page.evaluate(() => {
      document.documentElement.removeAttribute('data-theme');
    });
    await page.locator('[data-theme-toggle]').click();

    // Sample the computed background of <body> — must match the dark
    // token #14110D (rgb(20, 17, 13)).
    const bg = await page.evaluate(() => {
      return getComputedStyle(document.body).backgroundColor;
    });
    expect(bg).toBe('rgb(20, 17, 13)');
  });
});
