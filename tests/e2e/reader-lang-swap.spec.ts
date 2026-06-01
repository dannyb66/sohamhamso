import { expect, test } from '@playwright/test';

/**
 * ReaderLangSwap.solid.tsx — client-side reader-language swap.
 *
 * The verse page injects `window.__readerData` with every supported lang's
 * glosses + primary translation. On mount the island reads
 * `localStorage["sohamhamso:reader-lang"]` and, when ≠ "en", rewrites the
 * `.translation` paragraph + each `.sa-gloss` span in place — preserving
 * the `.sa-word` lemma buttons so the WordSheet click delegation still
 * works.
 *
 * Coverage:
 *   - karpuradi/1/1 has translations in all 12 langs → Hindi swap
 *     replaces .translation with Devanāgarī text.
 *   - karpuradi/1/1 + Tamil → Tamil-script text.
 *   - siva-sutras/1/1 has only English translations → fallback leaves
 *     the English `.translation` text untouched after setting lang="hi".
 *
 * The island hydrates at client:idle so we wait for networkidle before
 * asserting.
 */

const STORAGE_KEY = 'sohamhamso:reader-lang';

// Unicode block: Devanāgarī U+0900..U+097F. Tamil U+0B80..U+0BFF.
const DEVANAGARI = /[ऀ-ॿ]/;
const TAMIL = /[஀-௿]/;

test.describe('reader-lang swap (verse page)', () => {
  test('Hindi swap: karpuradi 1.1 .translation contains Devanāgarī', async ({ browser }) => {
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
    await page.goto('/shakta/karpuradi-stotra/1/1');
    await page.waitForLoadState('networkidle');

    const tr = page.locator('.translation').first();
    await expect(tr).toBeVisible();
    // Re-read once the island has had a tick to hydrate.
    await expect
      .poll(async () => (await tr.innerText()).match(DEVANAGARI)?.[0] ?? null, {
        timeout: 5000,
      })
      .not.toBeNull();

    const langAttr = await tr.getAttribute('lang');
    expect(langAttr).toBe('hi');

    await ctx.close();
  });

  test('Tamil swap: karpuradi 1.1 .translation contains Tamil-script chars', async ({
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
    await page.goto('/shakta/karpuradi-stotra/1/1');
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

  test("fallback: unknown reader-lang ('xx') keeps the rendered English content", async ({
    browser,
  }) => {
    // Use an invented lang code so we exercise the no-data branch even
    // when every actual Indic lang has content. ReaderLangSwap must
    // gracefully no-op when `glosses_by_lang[lang]` and
    // `translations_by_lang[lang]` are both missing.
    const ctx = await browser.newContext();
    await ctx.addInitScript(
      ([key, val]) => {
        try {
          localStorage.setItem(key as string, val as string);
        } catch {}
      },
      [STORAGE_KEY, 'xx'],
    );
    const page = await ctx.newPage();
    await page.goto('/trika/siva-sutras/1/1');
    await page.waitForLoadState('networkidle');

    const tr = page.locator('.translation').first();
    if ((await tr.count()) === 0) {
      test.info().annotations.push({
        type: 'skip',
        description: 'no .translation rendered on this page',
      });
      await ctx.close();
      return;
    }

    await expect(tr).toBeVisible();
    // Give the island a beat to (no-op) run.
    await page.waitForTimeout(300);

    const text = await tr.innerText();
    // No Devanāgarī (or any Indic script) — the swap must NOT have run.
    expect(text).not.toMatch(DEVANAGARI);
    expect(text).not.toMatch(TAMIL);
    // English content remains; basic ASCII letters present.
    expect(text).toMatch(/[A-Za-z]/);

    await ctx.close();
  });
});
