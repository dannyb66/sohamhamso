import { expect, test } from '@playwright/test';

/**
 * AIAssistedBadge — e2e contract.
 *
 * The verse `/trika/pratyabhijna-hrdayam/1/1` ships an EN translation with
 * `translator: "public-domain composite"` and `ai_assisted: false` — i.e.
 * the slate (PD) state of the locked badge matrix. We use that page to
 * assert:
 *
 *   - the slate variant class lands on the element
 *   - the pill never wraps (overflow: ellipsis, white-space: nowrap),
 *     pinning the "vertical blob" regression
 *   - aria-label matches the visible label
 *   - the tap target is ≥44px (a11y baseline)
 *   - clicking the summary opens the disclosure body with full provenance
 *   - the methodology link in the body points to /about/methodology
 *
 * A second pass on `/shakta/karpuradi-stotra/1/1` covers the amber state
 * ("AI · not verified") which is what that page actually renders.
 */
test.describe('AIAssistedBadge — slate (PD) state', () => {
  const URL = '/trika/pratyabhijna-hrdayam/1/1';

  test('slate variant pill is visible with PD provenance', async ({ page }) => {
    await page.goto(URL);
    await page.waitForLoadState('networkidle');

    const badge = page.locator('.ai-badge--slate').first();
    await expect(badge).toBeVisible();

    const summary = badge.locator('.ai-badge-summary');
    await expect(summary).toBeVisible();

    const label = badge.locator('.ai-badge-label');
    await expect(label).toBeVisible();

    const text = (await label.innerText()).trim();
    // Slate label always ends in "PD" — either via the auto-suffix or
    // because the translator string already encodes "public-domain".
    expect(text.toLowerCase()).toContain('public');
  });

  test('aria-label on the <details> matches the visible label', async ({ page }) => {
    await page.goto(URL);
    await page.waitForLoadState('networkidle');

    const badge = page.locator('.ai-badge--slate').first();
    const aria = await badge.getAttribute('aria-label');
    const visible = (await badge.locator('.ai-badge-label').innerText()).trim();
    expect(aria).toBe(visible);
  });

  test('pill renders on a single line (no vertical-blob regression)', async ({ page }) => {
    await page.goto(URL);
    await page.waitForLoadState('networkidle');

    const label = page.locator('.ai-badge--slate .ai-badge-label').first();
    await expect(label).toBeVisible();

    // Computed style must enforce nowrap + ellipsis truncation.
    const whiteSpace = await label.evaluate((el) => getComputedStyle(el).whiteSpace);
    const textOverflow = await label.evaluate((el) => getComputedStyle(el).textOverflow);
    const overflow = await label.evaluate((el) => getComputedStyle(el).overflow);
    expect(whiteSpace).toBe('nowrap');
    expect(textOverflow).toBe('ellipsis');
    expect(overflow).toBe('hidden');

    // Geometric check: the rendered height matches a single line. The
    // pill is 11px font-size, line-height:1 → label client height ≤ ~16px.
    const labelBox = await label.boundingBox();
    expect(labelBox).not.toBeNull();
    expect(labelBox!.height).toBeLessThan(24);
  });

  test('summary exposes a ≥44px tap target', async ({ page }) => {
    await page.goto(URL);
    await page.waitForLoadState('networkidle');

    const summary = page.locator('.ai-badge--slate .ai-badge-summary').first();
    await expect(summary).toBeVisible();

    // The ::before invisible overlay enforces a 44×44 minimum hit area.
    // We query its bounding rect via the pseudo's positioning rules. The
    // cleanest portable check is to inspect the summary's clickable
    // region: client width + ::before inset padding totals ≥44px in both
    // axes.
    const sized = await summary.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const before = getComputedStyle(el, '::before');
      // The ::before uses `inset: -10px -8px` plus min-height/width: 44px.
      // So effective tap target = max(rect+inset, 44).
      const minH = Number.parseFloat(before.minHeight) || 0;
      const minW = Number.parseFloat(before.minWidth) || 0;
      return {
        width: Math.max(rect.width + 16 /* 8+8 */, minW),
        height: Math.max(rect.height + 20 /* 10+10 */, minH),
      };
    });
    expect(sized.width).toBeGreaterThanOrEqual(44);
    expect(sized.height).toBeGreaterThanOrEqual(44);
  });

  test('clicking the summary opens the disclosure with provenance details', async ({ page }) => {
    await page.goto(URL);
    await page.waitForLoadState('networkidle');

    const badge = page.locator('.ai-badge--slate').first();
    const summary = badge.locator('.ai-badge-summary');
    const body = badge.locator('.ai-badge-body');

    // Closed by default.
    expect(await badge.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false);
    await expect(body).toBeHidden();

    await summary.click();

    expect(await badge.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true);
    await expect(body).toBeVisible();

    // Body must contain at least translator + status rows for slate badges.
    const bodyText = await body.innerText();
    expect(bodyText).toMatch(/Translator/i);
    expect(bodyText).toMatch(/Status/i);
    expect(bodyText.toLowerCase()).toContain('published');
  });

  test('methodology link in the body points to /about/methodology', async ({ page }) => {
    await page.goto(URL);
    await page.waitForLoadState('networkidle');

    const badge = page.locator('.ai-badge--slate').first();
    await badge.locator('.ai-badge-summary').click();

    const link = badge.locator('.ai-badge-body a[href="/about/methodology"]');
    await expect(link).toBeVisible();
    await expect(link).toHaveText(/How we translate/i);
  });
});

test.describe('AIAssistedBadge — amber (AI, not yet reviewed) state', () => {
  // karpuradi-stotra ships AI-assisted EN translations at status='published',
  // which is the amber state in the matrix.
  const URL = '/shakta/karpuradi-stotra/1/1';

  test("amber variant pill is visible with 'AI · not verified' label", async ({ page }) => {
    await page.goto(URL);
    await page.waitForLoadState('networkidle');

    const badge = page.locator('.ai-badge--amber').first();
    await expect(badge).toBeVisible();

    const label = badge.locator('.ai-badge-label');
    await expect(label).toHaveText('AI · not verified');

    const aria = await badge.getAttribute('aria-label');
    expect(aria).toBe('AI · not verified');
  });

  test('amber pill is also single-line (nowrap)', async ({ page }) => {
    await page.goto(URL);
    await page.waitForLoadState('networkidle');

    const label = page.locator('.ai-badge--amber .ai-badge-label').first();
    const whiteSpace = await label.evaluate((el) => getComputedStyle(el).whiteSpace);
    expect(whiteSpace).toBe('nowrap');
  });
});
