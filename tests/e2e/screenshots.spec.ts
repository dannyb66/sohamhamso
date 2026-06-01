import { test, devices } from "@playwright/test";
import { mkdirSync } from "node:fs";

const DIR = "/tmp/qa-screenshots";

test.beforeAll(() => {
  mkdirSync(DIR, { recursive: true });
});

test("01 homepage mobile", async ({ browser }) => {
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  await page.goto("/");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.screenshot({ path: `${DIR}/01-homepage-mobile.png`, fullPage: true });
  await ctx.close();
});

test("02 homepage desktop", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("/");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.screenshot({ path: `${DIR}/02-homepage-desktop.png`, fullPage: true });
  await ctx.close();
});

test("03 verse page mobile", async ({ browser }) => {
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  await page.goto("/trika/siva-sutras/1/1");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.screenshot({ path: `${DIR}/03-verse-page-mobile.png`, fullPage: true });
  await ctx.close();
});

test("04 verse page desktop", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("/trika/siva-sutras/1/1");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.screenshot({ path: `${DIR}/04-verse-page-desktop.png`, fullPage: true });
  await ctx.close();
});

test("05 sample", async ({ page }) => {
  await page.goto("/sample");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.screenshot({ path: `${DIR}/05-sample.png`, fullPage: true });
});

test("06 texts index", async ({ page }) => {
  await page.goto("/texts");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.screenshot({ path: `${DIR}/06-texts-index.png`, fullPage: true });
});

test("07 dark theme attempt", async ({ page }) => {
  await page.goto("/trika/siva-sutras/1/1");
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${DIR}/07-dark-theme.png`, fullPage: true });
});

test("08 sepia theme attempt", async ({ page }) => {
  await page.goto("/trika/siva-sutras/1/1");
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "sepia"));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${DIR}/08-sepia-theme.png`, fullPage: true });
});
