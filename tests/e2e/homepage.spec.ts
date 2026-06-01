import { test, expect } from "@playwright/test";

test.describe("homepage", () => {
  test("loads quickly and renders wordmark", async ({ page }) => {
    const t0 = Date.now();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(2000);
    // Wordmark "sohamhamso" — case-insensitive, may appear multiple times
    await expect(page.getByText(/sohamhamso/i).first()).toBeVisible();
    expect(errors, `console errors: ${errors.join("\n")}`).toHaveLength(0);
  });

  test("featured verse hero renders Devanagari + IAST + English", async ({ page }) => {
    await page.goto("/");
    // Devanagari block — should contain at least one DevaCharacter
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).toMatch(/[ऀ-ॿ]/);
    // IAST (Latin with diacritics) — at minimum the wordmark "sohamhamso"
    // Hero verse is curated; assert IAST-style diacritic exists somewhere
    expect(bodyText).toMatch(/[āīūṛḷṅñṭḍṇśṣ]/);
    // English translation in hero — at least some prose under the verse
    expect(bodyText.length).toBeGreaterThan(200);
  });

  test("curated entries section: all three entry points present", async ({ page }) => {
    await page.goto("/");
    // Scope to the curated <section> so we don't match hidden masthead links
    // ("All texts" exists in both places).
    const curated = page.locator('section.curated, section[aria-label*="begin" i]');
    await expect(curated).toHaveCount(1);
    await curated.locator(":scope >> text=/if you are new/i").first().scrollIntoViewIfNeeded();
    await expect(curated.getByText(/if you are new/i)).toBeVisible();
    await expect(curated.getByText(/daily readings/i)).toBeVisible();
    await expect(curated.getByText(/all texts/i)).toBeVisible();
  });

  test("subscribe band: email input and submit button", async ({ page }) => {
    await page.goto("/");
    // Scope to the subscribe <section> so we don't match the masthead search
    // "Close" button (which is type=submit and hidden by default).
    const sub = page.locator('section.subscribe, section[aria-labelledby="subscribe-heading"]');
    await expect(sub).toHaveCount(1);
    const emailInput = sub.locator('input[type="email"]');
    await emailInput.scrollIntoViewIfNeeded();
    await expect(emailInput).toBeVisible();
    await expect(sub.locator('button[type="submit"]')).toBeVisible();
  });

  test("footer: required link texts present", async ({ page }) => {
    await page.goto("/");
    const required = [
      "Sources",
      "Methodology",
      "License",
      "GitHub",
      "Zenodo",
      "Donate",
      "Privacy",
      "Colophon",
    ];
    const body = await page.locator("body").innerText();
    for (const t of required) {
      expect(body, `footer missing "${t}"`).toContain(t);
    }
  });
});
