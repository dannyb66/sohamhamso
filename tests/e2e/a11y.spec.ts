import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("accessibility (WCAG AA)", () => {
  test("homepage: axe scan, report violations", async ({ page }) => {
    await page.goto("/");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const summary = results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.length,
    }));
    test.info().annotations.push({
      type: "axe-homepage",
      description: JSON.stringify(summary, null, 2),
    });
    // Do not fail — this is report-only per QA spec.
    expect(true).toBe(true);
  });

  test("verse page: axe scan, report violations", async ({ page }) => {
    await page.goto("/trika/siva-sutras/1/1");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const summary = results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.length,
    }));
    test.info().annotations.push({
      type: "axe-verse",
      description: JSON.stringify(summary, null, 2),
    });
    expect(true).toBe(true);
  });

  test("focus visible: Tab navigation reaches interactive elements", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(
      () => document.activeElement?.tagName || "(none)",
    );
    expect(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"]).toContain(focused);
  });

  test("skip link present (or noted absent)", async ({ page }) => {
    await page.goto("/");
    const skip = page.locator('a[href="#main"], a:has-text("Skip"), a:has-text("skip")').first();
    const present = await skip.count();
    test.info().annotations.push({
      type: "skip-link",
      description: present ? "present" : "ABSENT — file as P3 a11y bug",
    });
  });
});
