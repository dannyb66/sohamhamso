import { test, expect } from "@playwright/test";

/**
 * SettingsSheet.solid.tsx — reading-controls bottom sheet.
 *
 * Trigger: [data-settings-trigger] button (the "Aa" chip in the verse
 * page header) dispatches `sohamhamso:open-settings`. The sheet is
 * `client:idle`-hydrated in BaseLayout.
 *
 * Persistence: all settings live in localStorage under
 * `sohamhamso:settings` as a single JSON blob.
 */
test.describe("settings sheet (Aa)", () => {
  const VERSE_URL = "/trika/siva-sutras/1/1";
  const STORAGE_KEY = "sohamhamso:settings";
  const SETTINGS_DIALOG = '[role="dialog"][aria-labelledby="settings-sheet-title"]';

  test.beforeEach(async ({ page }) => {
    // Clear stored settings so each test starts from defaults.
    await page.goto(VERSE_URL);
    await page.evaluate((k) => localStorage.removeItem(k), STORAGE_KEY);
    await page.evaluate(() => localStorage.removeItem("sohamhamso:theme"));
  });

  test("clicking the Aa button opens the sheet", async ({ page }) => {
    await page.goto(VERSE_URL);
    await page.waitForLoadState("networkidle");
    const trigger = page.locator("[data-settings-trigger]").first();
    await expect(trigger).toBeVisible();
    await trigger.click();
    const sheet = page.locator(SETTINGS_DIALOG).first();
    await expect(sheet).toBeVisible({ timeout: 2000 });
  });

  test("changing the theme to Dark sets <html data-theme=\"dark\">", async ({
    page,
  }) => {
    await page.goto(VERSE_URL);
    await page.waitForLoadState("networkidle");
    const trigger = page.locator("[data-settings-trigger]").first();
    if (!(await trigger.count())) {
      test.info().annotations.push({
        type: "skip",
        description: "no settings trigger on this page",
      });
      return;
    }
    await trigger.click();
    const sheet = page.locator(SETTINGS_DIALOG).first();
    await expect(sheet).toBeVisible({ timeout: 2000 });

    // Theme buttons are <button class="settings__theme"> with text labels.
    const darkBtn = sheet.locator(".settings__theme", { hasText: "Dark" }).first();
    await darkBtn.click();
    const theme = await page.locator("html").getAttribute("data-theme");
    expect(theme).toBe("dark");
  });

  test("changing font size updates the --text-base CSS variable on <html>", async ({
    page,
  }) => {
    await page.goto(VERSE_URL);
    await page.waitForLoadState("networkidle");
    const trigger = page.locator("[data-settings-trigger]").first();
    if (!(await trigger.count())) {
      test.info().annotations.push({ type: "skip", description: "no trigger" });
      return;
    }
    await trigger.click();
    const sheet = page.locator(SETTINGS_DIALOG).first();
    await expect(sheet).toBeVisible({ timeout: 2000 });

    const slider = sheet.locator('input[type="range"][aria-label="Font size in pixels"]');
    await expect(slider).toBeVisible();
    // Set explicitly to 22 via fill (works on range inputs in Playwright).
    await slider.fill("22");
    // Confirm by reading the live CSS variable applySettings() writes.
    const value = await page.evaluate(() =>
      document.documentElement.style.getPropertyValue("--text-base").trim(),
    );
    expect(value).toBe("22px");
  });

  test("localStorage `sohamhamso:settings` persists and survives reload", async ({
    page,
  }) => {
    await page.goto(VERSE_URL);
    await page.waitForLoadState("networkidle");
    const trigger = page.locator("[data-settings-trigger]").first();
    if (!(await trigger.count())) {
      test.info().annotations.push({ type: "skip", description: "no trigger" });
      return;
    }
    await trigger.click();
    const sheet = page.locator(SETTINGS_DIALOG).first();
    await expect(sheet).toBeVisible({ timeout: 2000 });

    await sheet.locator(".settings__theme", { hasText: "Dark" }).click();
    await sheet
      .locator('input[type="range"][aria-label="Font size in pixels"]')
      .fill("20");

    // Read directly from localStorage before reload to confirm save.
    const stored = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored ?? "{}");
    expect(parsed.theme).toBe("dark");
    expect(parsed.fontSizePx).toBe(20);

    // Reload — applySettings() runs on mount.
    await page.reload();
    await page.waitForLoadState("networkidle");
    const themeAfter = await page.locator("html").getAttribute("data-theme");
    expect(themeAfter).toBe("dark");
    const fontAfter = await page.evaluate(() =>
      document.documentElement.style.getPropertyValue("--text-base").trim(),
    );
    expect(fontAfter).toBe("20px");
  });
});
