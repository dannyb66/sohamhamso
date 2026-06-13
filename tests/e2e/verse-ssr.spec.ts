import { expect, test } from '@playwright/test';

/**
 * SSR verse routes (A6 phase 2) — request-time behavior that static
 * builds used to guarantee structurally:
 *
 *   - SEO head invariants (canonical, hreflang, og:image) are unchanged
 *     vs the prerendered baseline (verified against the last static
 *     build's dist/trika/siva-sutras/1/1.html during the migration).
 *   - Alias URLs 301 in-handler (the per-verse static redirect pages are
 *     gone; public/_redirects wildcards cover the CDN path in prod).
 *   - Genuine bad refs return the styled 404 (404.astro posture), not a
 *     blank adapter error.
 *   - OK responses carry the deploy-bounded cache policy.
 */

test.describe('SSR verse route — head + cache invariants', () => {
  const url = '/trika/siva-sutras/1/1';

  test('canonical, hreflang, og:image and JSON-LD are present', async ({ page }) => {
    await page.goto(url);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      'https://sohamhamso.org/trika/siva-sutras/1/1',
    );
    // Pre-launch locale gating: EN page carries en + x-default entries.
    await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute(
      'href',
      'https://sohamhamso.org/trika/siva-sutras/1/1',
    );
    await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveCount(1);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      'content',
      'https://sohamhamso.org/og/trika/siva-sutras/1/1?lang=en',
    );
    expect(await page.locator('script[type="application/ld+json"]').count()).toBeGreaterThan(0);
  });

  test('OK responses carry the long shared-cache policy', async ({ page }) => {
    const response = await page.goto(url);
    expect(response?.status()).toBe(200);
    const cacheControl = response?.headers()['cache-control'] ?? '';
    expect(cacheControl).toContain('s-maxage=86400');
    expect(cacheControl).toContain('stale-while-revalidate');
  });
});

test.describe('SSR verse route — alias redirects', () => {
  test('wrong tradition 301s to canonical', async ({ page }) => {
    await page.goto('/shaiva/siva-sutras/1/1');
    await expect(page).toHaveURL(/\/trika\/siva-sutras\/1\/1$/);
  });

  test('slug alias 301s to canonical, locale prefix preserved', async ({ page }) => {
    await page.goto('/hi/trika/shiva-sutras/1/2');
    await expect(page).toHaveURL(/\/hi\/trika\/siva-sutras\/1\/2$/);
  });
});

test.describe('SSR verse route — failure UX', () => {
  test('missing verse returns the styled 404', async ({ page }) => {
    const response = await page.goto('/trika/siva-sutras/99/99');
    expect(response?.status()).toBe(404);
    await expect(page.locator('.not-found__title')).toContainText("isn't in the corpus");
    await expect(page.locator('.not-found__actions a').first()).toHaveAttribute('href', '/search');
  });

  test('non-numeric locator returns the styled 404 without a DB read', async ({ page }) => {
    const response = await page.goto('/trika/siva-sutras/notes/1');
    expect(response?.status()).toBe(404);
    await expect(page.locator('.not-found__eyebrow')).toHaveText('404');
  });

  test('unknown locale prefix returns the styled 404', async ({ page }) => {
    const response = await page.goto('/xx/trika/siva-sutras/1/1');
    expect(response?.status()).toBe(404);
  });
});

test.describe('SSR verse route — neighbours unaffected', () => {
  test('prerendered chapter page at the same depth still renders', async ({ page }) => {
    // /hi/trika/siva-sutras/2 has the same segment count as the root
    // verse route — guard against the SSR route shadowing it.
    const response = await page.goto('/hi/trika/siva-sutras/2');
    expect(response?.status()).toBe(200);
    const body = await page.locator('body').innerText();
    expect(body).toMatch(/[ऀ-ॿ]/);
  });
});
