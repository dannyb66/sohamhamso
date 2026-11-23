import { type Page, expect, test } from '@playwright/test';

/**
 * Opt-in GA4 (src/components/Analytics.astro + src/lib/analytics-client.ts).
 *
 * Two dev servers (playwright.config.ts):
 *   :4321 — no PUBLIC_GA_MEASUREMENT_ID → analytics must render nothing.
 *   :4322 — PUBLIC_GA_MEASUREMENT_ID=G-E2ETEST000 → consent flow active.
 *
 * Every googletagmanager.com / google-analytics.com request is stubbed and
 * recorded, so the suite never talks to Google.
 */
const GA_ON = 'http://localhost:4322';
const GA_OFF = 'http://localhost:4321';
const PAGE = '/about/privacy';
const CONSENT_KEY = 'sohamhamso:analytics-consent';
const BANNER = '[data-consent-banner]';

async function recordGoogleRequests(page: Page): Promise<string[]> {
  const urls: string[] = [];
  await page.route(
    /https:\/\/([a-z0-9-]+\.)*(googletagmanager|google-analytics)\.com\//,
    (route) => {
      urls.push(route.request().url());
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
    },
  );
  return urls;
}

async function gaCookies(page: Page) {
  return (await page.context().cookies()).filter((c) => c.name.startsWith('_ga'));
}

test.describe('analytics disabled (no measurement ID)', () => {
  test('renders no banner, no runtime and requests nothing from Google', async ({ page }) => {
    const google = await recordGoogleRequests(page);
    await page.goto(GA_OFF + PAGE);
    await page.waitForLoadState('networkidle');
    await expect(page.locator(BANNER)).toHaveCount(0);
    expect(await page.evaluate(() => typeof window.sohamhamsoAnalytics)).toBe('undefined');
    expect(google).toEqual([]);
  });

  test('reading settings show no analytics row', async ({ page }) => {
    await page.goto(GA_OFF + PAGE);
    await page.waitForFunction(
      () => !!document.querySelector('astro-island[component-url*="SettingsSheet"]:not([ssr])'),
    );
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('sohamhamso:open-settings')));
    await expect(page.locator('[aria-labelledby="settings-sheet-title"]').first()).toBeVisible();
    await expect(page.locator('[data-analytics-consent-toggle]')).toHaveCount(0);
  });
});

test.describe('analytics consent flow', () => {
  test('first visit shows the banner and loads nothing before consent', async ({ page }) => {
    const google = await recordGoogleRequests(page);
    await page.goto(GA_ON + PAGE);
    await page.waitForLoadState('networkidle');
    await expect(page.locator(BANNER)).toBeVisible();
    expect(google).toEqual([]);
    expect(await gaCookies(page)).toEqual([]);
    // Consent Mode defaults are queued as denied.
    const defaults = await page.evaluate(() =>
      (window.dataLayer ?? []).map((entry) => Array.from(entry as ArrayLike<unknown>)),
    );
    expect(defaults).toContainEqual([
      'consent',
      'default',
      {
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
        analytics_storage: 'denied',
      },
    ]);
  });

  test('"Allow analytics" loads gtag with privacy flags and persists', async ({ page }) => {
    const google = await recordGoogleRequests(page);
    await page.goto(GA_ON + PAGE);
    await page.locator('[data-consent-accept]').click();
    await expect(page.locator(BANNER)).toBeHidden();
    await expect
      .poll(() => google.some((u) => u.includes('gtag/js?id=G-E2ETEST000')), { timeout: 15_000 })
      .toBe(true);
    expect(await page.evaluate((k) => localStorage.getItem(k), CONSENT_KEY)).toBe('granted');

    const config = await page.evaluate(() =>
      (window.dataLayer ?? [])
        .map((entry) => Array.from(entry as ArrayLike<unknown>))
        .find((args) => args[0] === 'config'),
    );
    expect(config).toEqual([
      'config',
      'G-E2ETEST000',
      { allow_google_signals: false, allow_ad_personalization_signals: false },
    ]);

    // Returning visit: no banner, gtag loads on idle.
    google.length = 0;
    await page.reload();
    await expect(page.locator(BANNER)).toBeHidden();
    await expect
      .poll(() => google.some((u) => u.includes('gtag/js')), { timeout: 15_000 })
      .toBe(true);
  });

  test('"No thanks" loads nothing, now or on the next visit', async ({ page }) => {
    const google = await recordGoogleRequests(page);
    await page.goto(GA_ON + PAGE);
    await page.locator('[data-consent-decline]').click();
    await expect(page.locator(BANNER)).toBeHidden();
    expect(await page.evaluate((k) => localStorage.getItem(k), CONSENT_KEY)).toBe('denied');

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator(BANNER)).toBeHidden();
    expect(google).toEqual([]);
  });

  test('site events are forwarded only after consent', async ({ page }) => {
    await recordGoogleRequests(page);
    await page.goto(GA_ON + PAGE);
    const eventNames = () =>
      page.evaluate(() =>
        (window.dataLayer ?? [])
          .map((entry) => Array.from(entry as ArrayLike<unknown>))
          .filter((args) => args[0] === 'event')
          .map((args) => args[1]),
      );

    await page.evaluate(() =>
      document.dispatchEvent(
        new CustomEvent('sohamhamso:translations-changed', { detail: { selected: ['hi'] } }),
      ),
    );
    expect(await eventNames()).toEqual([]);

    await page.locator('[data-consent-accept]').click();
    await page.evaluate(() =>
      document.dispatchEvent(
        new CustomEvent('sohamhamso:translations-changed', { detail: { selected: ['hi', 'ta'] } }),
      ),
    );
    expect(await eventNames()).toEqual(['parallel_translations_change']);
  });

  test('settings toggle withdraws consent and clears GA cookies', async ({ page }) => {
    await recordGoogleRequests(page);
    await page.goto(GA_ON + PAGE);
    await page.locator('[data-consent-accept]').click();
    // Simulate the cookie gtag.js would have set.
    await page.evaluate(() => {
      document.cookie = '_ga=GA1.1.123.456; path=/';
      document.cookie = '_ga_E2ETEST000=GS1.1.789; path=/';
    });
    expect((await gaCookies(page)).length).toBe(2);

    await page.waitForFunction(
      () => !!document.querySelector('astro-island[component-url*="SettingsSheet"]:not([ssr])'),
    );
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('sohamhamso:open-settings')));
    const toggle = page.locator('[data-analytics-consent-toggle]');
    await expect(toggle).toBeChecked();
    await toggle.uncheck();

    expect(await page.evaluate((k) => localStorage.getItem(k), CONSENT_KEY)).toBe('denied');
    expect(await gaCookies(page)).toEqual([]);
    expect(
      await page.evaluate(
        () => (window as unknown as Record<string, unknown>)['ga-disable-G-E2ETEST000'],
      ),
    ).toBe(true);
  });

  test('Global Privacy Control suppresses the banner and the tag', async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({ ...testInfo.project.use });
    await context.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true });
    });
    const page = await context.newPage();
    const google = await recordGoogleRequests(page);
    await page.goto(GA_ON + PAGE);
    await page.waitForLoadState('networkidle');
    await expect(page.locator(BANNER)).toBeHidden();
    expect(await page.evaluate(() => window.sohamhamsoAnalytics?.gpc)).toBe(true);
    expect(google).toEqual([]);
    await context.close();
  });

  test('withdrawing before the idle load wins (no late gtag)', async ({ page }) => {
    const google = await recordGoogleRequests(page);
    await page.addInitScript((k) => {
      // Returning visitor who allowed analytics earlier…
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem(k, 'granted');
        sessionStorage.setItem('seeded', '1');
      }
      // …on a browser whose idle callback is slow.
      window.requestIdleCallback = ((cb: IdleRequestCallback) =>
        window.setTimeout(
          () => cb({ didTimeout: true, timeRemaining: () => 0 }),
          3000,
        )) as typeof window.requestIdleCallback;
    }, CONSENT_KEY);
    await page.goto(GA_ON + PAGE);
    await page.waitForFunction(() => !!window.sohamhamsoAnalytics);
    await page.evaluate(() => window.sohamhamsoAnalytics?.setConsent('denied'));
    await page.waitForTimeout(4500);
    expect(google).toEqual([]);
    expect(await gaCookies(page)).toEqual([]);
  });

  test('a choice made in another tab applies to open tabs', async ({ page }) => {
    const google = await recordGoogleRequests(page);
    await page.goto(GA_ON + PAGE);
    await expect(page.locator(BANNER)).toBeVisible();
    const other = await page.context().newPage();
    await recordGoogleRequests(other);
    await other.goto(GA_ON + PAGE);
    await other.locator('[data-consent-accept]').click();
    // `storage` events fire in the *other* same-origin tabs.
    await expect(page.locator(BANNER)).toBeHidden();
    await expect
      .poll(() => google.some((u) => u.includes('gtag/js')), { timeout: 15_000 })
      .toBe(true);

    await other.evaluate(() => window.sohamhamsoAnalytics?.setConsent('denied'));
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as Record<string, unknown>)['ga-disable-G-E2ETEST000'],
        ),
      )
      .toBe(true);
  });

  test('consent banner and language banner stack without overlapping', async ({ page }) => {
    await recordGoogleRequests(page);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    });
    await page.goto(`${GA_ON}/hi${PAGE}`);
    const consent = page.locator(BANNER);
    const lang = page.locator('[data-lang-banner]');
    await expect(consent).toBeVisible();
    await expect(lang).toBeVisible();
    const a = await lang.boundingBox();
    const b = await consent.boundingBox();
    expect(a && b).toBeTruthy();
    if (a && b) expect(a.y + a.height).toBeLessThanOrEqual(b.y);
  });

  test('email landing pages opt out entirely', async ({ page }) => {
    const google = await recordGoogleRequests(page);
    for (const path of ['/confirmed', '/unsubscribed']) {
      await page.goto(GA_ON + path);
      await expect(page.locator(BANNER)).toHaveCount(0);
    }
    expect(google).toEqual([]);
  });
});
