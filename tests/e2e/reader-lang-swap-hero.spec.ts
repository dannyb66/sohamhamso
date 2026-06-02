import { expect, test } from '@playwright/test';

/**
 * Homepage FeaturedVerseHero — i18n translation swap regression.
 *
 * Bug it covers: the homepage hero used to render the daily verse with
 * an English translation paragraph that never swapped when the user
 * picked a non-English reader-lang. The fix:
 *   1. FeaturedVerseHero now adds `class="translation"` + `lang="en"`
 *      to the translation paragraph and injects `window.__readerData`
 *      with every supported lang's translation.
 *   2. ReaderLangSwap moved from the verse-page route to BaseLayout so
 *      it runs site-wide and picks up the hero payload.
 *
 * Assertions: visit `/` with `sohamhamso:reader-lang = "hi"` set before
 * navigation, then verify the hero `.translation` paragraph contains
 * Devanāgarī characters and carries `lang="hi"`. Re-runs for Tamil so
 * we don't regress on the polyglot path.
 */

const STORAGE_KEY = 'sohamhamso:reader-lang';
const DEVANAGARI = /[ऀ-ॿ]/;
const TAMIL = /[஀-௿]/;

test.describe('reader-lang swap (homepage hero)', () => {
  test('Hindi swap: homepage hero .translation contains Devanāgarī', async ({ browser }) => {
    const ctx = await browser.newContext();
    await ctx.addInitScript(
      ([key, val]) => {
        try {
          localStorage.setItem(key as string, val as string);
        } catch {}
      },
      [STORAGE_KEY, 'hi'],
    );
    const page = await ctx.newPage();
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const tr = page.locator('.translation').first();
    await expect(tr).toBeVisible();
    await expect
      .poll(async () => (await tr.innerText()).match(DEVANAGARI)?.[0] ?? null, {
        timeout: 5000,
      })
      .not.toBeNull();

    const langAttr = await tr.getAttribute('lang');
    expect(langAttr).toBe('hi');

    await ctx.close();
  });

  test('Tamil swap: homepage hero .translation contains Tamil-script chars', async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    await ctx.addInitScript(
      ([key, val]) => {
        try {
          localStorage.setItem(key as string, val as string);
        } catch {}
      },
      [STORAGE_KEY, 'ta'],
    );
    const page = await ctx.newPage();
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const tr = page.locator('.translation').first();
    await expect(tr).toBeVisible();
    await expect
      .poll(async () => (await tr.innerText()).match(TAMIL)?.[0] ?? null, {
        timeout: 5000,
      })
      .not.toBeNull();

    const langAttr = await tr.getAttribute('lang');
    expect(langAttr).toBe('ta');

    await ctx.close();
  });

  test('English (default): homepage hero .translation stays in English', async ({ browser }) => {
    // No init script — default lang is English. The static SSR already
    // renders English; ReaderLangSwap is a no-op on `en`.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const tr = page.locator('.translation').first();
    await expect(tr).toBeVisible();
    const text = await tr.innerText();
    expect(text).not.toMatch(DEVANAGARI);
    expect(text).not.toMatch(TAMIL);
    expect(text).toMatch(/[A-Za-z]/);

    await ctx.close();
  });
});
