import { type Page, type Route, expect, test } from '@playwright/test';

/**
 * /donate client behaviour with Stripe.js stubbed (no network to Stripe).
 * Covers tab selection, amount chips, fee cover, bounds, the intent request
 * the browser sends (currency, base amount), confirm, thank-you and errors.
 *
 * Requires the dev server to run with PUBLIC_STRIPE_PUBLISHABLE_KEY set to
 * any pk_test_… value and PUBLIC_DONATE_UPI=1; skipped otherwise. The real Stripe flow is covered by
 * the manual preview checklist in docs/DONATIONS.md.
 */

const FAKE_STRIPE = `
(() => {
  window.__stripe = { elementsOpts: null, updates: [], confirms: 0, confirmResult: null };
  window.Stripe = function () {
    return {
      _registerWrapper() {},
      registerAppInfo() {},
      elements(opts) {
        // Mirror Stripe.js (Endive): the legacy option throws.
        if (opts && 'paymentMethodTypes' in opts) {
          throw new Error('IntegrationError: paymentMethodTypes is no longer supported');
        }
        window.__stripe.elementsOpts = opts;
        return {
          update(u) { window.__stripe.updates.push(u); },
          submit: async () => ({}),
          create(type) {
            const handlers = {};
            return {
              on(ev, fn) { handlers[ev] = fn; },
              mount(el) {
                const d = document.createElement('div');
                d.dataset.fake = type;
                d.textContent = 'fake ' + type;
                el.appendChild(d);
                setTimeout(() => handlers.ready && handlers.ready({ availablePaymentMethods: null }), 20);
              },
            };
          },
        };
      },
      async confirmPayment() {
        window.__stripe.confirms++;
        return window.__stripe.confirmResult || { paymentIntent: { status: 'succeeded' } };
      },
      async retrievePaymentIntent() { return { paymentIntent: { status: 'succeeded' } }; },
    };
  };
})();`;

type StubState = {
  elementsOpts: {
    mode: string;
    currency: string;
    amount: number;
    allowedPaymentMethodTypes?: string[];
  };
  confirmResult: unknown;
};
type StubWindow = Window & { __stripe: StubState };

async function stubStripe(page: Page): Promise<void> {
  await page.route(/js\.stripe\.com/, (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: FAKE_STRIPE }),
  );
}

async function hasEmbeddedCheckout(page: Page): Promise<boolean> {
  // Both rails present: publishable key set and PUBLIC_DONATE_UPI=1.
  return (await page.locator('[data-rail-form]').count()) > 1;
}

test.describe('donate page (Stripe stubbed)', () => {
  test.beforeEach(async ({ page }) => {
    await stubStripe(page);
  });

  test('UPI tab: rupee amounts, fee cover, INR intent, thank-you', async ({ page }) => {
    const intents: Record<string, unknown>[] = [];
    await page.route('**/api/donate/intent', async (route) => {
      intents.push(route.request().postDataJSON());
      await route.fulfill({ json: { ok: true, clientSecret: 'pi_test_secret_x' } });
    });
    await page.goto('/donate?method=upi&src=e2e');
    test.skip(
      !(await hasEmbeddedCheckout(page)),
      'PUBLIC_STRIPE_PUBLISHABLE_KEY / PUBLIC_DONATE_UPI not set',
    );

    const tab = page.getByRole('tab', { name: 'UPI · India' });
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    const panel = page.locator('[data-panel="upi"]');
    await expect(panel).toBeVisible();
    await expect(page.locator('[data-panel="card"]')).toBeHidden();

    await expect(panel.locator('[data-fake="payment"]')).toBeVisible();
    await expect(panel.locator('[data-fake="expressCheckout"]')).toHaveCount(0);
    const opts = await page.evaluate(() => (window as unknown as StubWindow).__stripe.elementsOpts);
    expect(opts).toMatchObject({ mode: 'payment', currency: 'inr', amount: 50100 });
    expect(opts.allowedPaymentMethodTypes).toEqual(['upi']);

    const submit = panel.locator('[data-submit]');
    await expect(submit).toBeEnabled();
    await expect(submit).toHaveText('Give ₹501');
    await expect(panel.locator('[data-fee-amount]')).toHaveText('₹23.61');

    await panel.locator('[data-cover-fees]').check();
    await expect(submit).toHaveText('Give ₹524.61');

    await panel.getByRole('button', { name: '₹1,001' }).click();
    await expect(submit).toHaveText('Give ₹1,048.17');

    await panel.locator('[data-custom]').fill('50');
    await expect(panel.locator('[data-error]')).toHaveText('The minimum gift is ₹100.');
    await expect(submit).toBeDisabled();
    await panel.locator('[data-custom]').fill('2,101');
    await expect(panel.locator('[data-error]')).toBeHidden();

    await panel.locator('summary').click();
    await panel.locator('[data-ledger-name]').fill('Asha');
    await submit.click();

    await expect(panel.locator('[data-thanks]')).toBeVisible();
    await expect(panel.locator('[data-rail-form]')).toBeHidden();
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      currency: 'inr',
      baseCents: 210100,
      coverFees: true,
      source: 'e2e',
      ledgerName: 'Asha',
    });
    expect(String(intents[0]?.idempotencyKey)).toMatch(/^[A-Za-z0-9-]{16,64}$/);
  });

  test('card tab: dollar amounts, express checkout, USD intent', async ({ page }) => {
    const intents: Record<string, unknown>[] = [];
    await page.route('**/api/donate/intent', async (route) => {
      intents.push(route.request().postDataJSON());
      await route.fulfill({ json: { ok: true, clientSecret: 'pi_test_secret_y' } });
    });
    await page.goto('/donate?method=card');
    test.skip(
      !(await hasEmbeddedCheckout(page)),
      'PUBLIC_STRIPE_PUBLISHABLE_KEY / PUBLIC_DONATE_UPI not set',
    );

    const panel = page.locator('[data-panel="card"]');
    await expect(page.getByRole('tab', { name: 'Card · Apple Pay · Google Pay' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(panel.locator('[data-fake="expressCheckout"]')).toHaveCount(1);
    await expect(panel.locator('[data-fake="payment"]')).toBeVisible();
    const opts = await page.evaluate(() => (window as unknown as StubWindow).__stripe.elementsOpts);
    expect(opts).toMatchObject({ mode: 'payment', currency: 'usd', amount: 1100 });
    expect(opts.allowedPaymentMethodTypes).toBeUndefined();

    const submit = panel.locator('[data-submit]');
    await expect(submit).toHaveText('Give $11');
    await panel.locator('[data-cover-fees]').check();
    await expect(submit).toHaveText('Give $11.64');
    await submit.click();
    await expect(panel.locator('[data-thanks]')).toBeVisible();
    expect(intents[0]).toMatchObject({ currency: 'usd', baseCents: 1100, coverFees: true });
  });

  test('wallet buttons are disabled while the amount is invalid', async ({ page }) => {
    await page.goto('/donate?method=card');
    test.skip(
      !(await hasEmbeddedCheckout(page)),
      'PUBLIC_STRIPE_PUBLISHABLE_KEY / PUBLIC_DONATE_UPI not set',
    );
    const panel = page.locator('[data-panel="card"]');
    const express = panel.locator('[data-express-element]');
    await expect(panel.locator('[data-fake="expressCheckout"]')).toHaveCount(1);
    await expect(express).toHaveAttribute('aria-disabled', 'false');
    await panel.locator('[data-custom]').fill('1');
    await expect(panel.locator('[data-error]')).toHaveText('The minimum gift is $3.');
    await expect(express).toHaveAttribute('aria-disabled', 'true');
    await expect(express).toHaveCSS('pointer-events', 'none');
    await panel.locator('[data-custom]').fill('3');
    await expect(express).toHaveAttribute('aria-disabled', 'false');
    await expect(panel.locator('[data-submit]')).toHaveText('Give $3');
  });

  test('switching tabs keeps each rail independent', async ({ page }) => {
    await page.goto('/donate?method=card');
    test.skip(
      !(await hasEmbeddedCheckout(page)),
      'PUBLIC_STRIPE_PUBLISHABLE_KEY / PUBLIC_DONATE_UPI not set',
    );
    await page.getByRole('tab', { name: 'UPI · India' }).click();
    await expect(page.locator('[data-panel="upi"]')).toBeVisible();
    await expect(page.locator('[data-panel="card"]')).toBeHidden();
    await expect(page.locator('[data-panel="upi"] [data-submit]')).toHaveText('Give ₹501');
    await page.getByRole('tab', { name: 'Card · Apple Pay · Google Pay' }).click();
    await expect(page.locator('[data-panel="card"] [data-submit]')).toHaveText('Give $11');
  });

  test('India timezone defaults to UPI', async ({ browser }) => {
    const ctx = await browser.newContext({ timezoneId: 'Asia/Kolkata' });
    const page = await ctx.newPage();
    await stubStripe(page);
    await page.goto('/donate');
    test.skip(
      !(await hasEmbeddedCheckout(page)),
      'PUBLIC_STRIPE_PUBLISHABLE_KEY / PUBLIC_DONATE_UPI not set',
    );
    await expect(page.getByRole('tab', { name: 'UPI · India' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await ctx.close();
  });

  test('declined UPI payment shows an error and allows retry', async ({ page }) => {
    await page.route('**/api/donate/intent', (route) =>
      route.fulfill({ json: { ok: true, clientSecret: 'pi_test_secret_z' } }),
    );
    await page.goto('/donate?method=upi');
    test.skip(
      !(await hasEmbeddedCheckout(page)),
      'PUBLIC_STRIPE_PUBLISHABLE_KEY / PUBLIC_DONATE_UPI not set',
    );
    const panel = page.locator('[data-panel="upi"]');
    await expect(panel.locator('[data-submit]')).toBeEnabled(); // Stripe stub loaded
    await page.evaluate(() => {
      (window as unknown as StubWindow).__stripe.confirmResult = {
        error: { message: 'The UPI request expired. Please try again.' },
      };
    });
    await panel.locator('[data-submit]').click();
    await expect(panel.locator('[data-error]')).toHaveText(
      'The UPI request expired. Please try again.',
    );
    await expect(panel.locator('[data-submit]')).toBeEnabled();
    await expect(panel.locator('[data-thanks]')).toBeHidden();
  });

  test('server errors surface to the donor (real endpoint, no secret key)', async ({ page }) => {
    await page.goto('/donate?method=upi');
    test.skip(
      !(await hasEmbeddedCheckout(page)),
      'PUBLIC_STRIPE_PUBLISHABLE_KEY / PUBLIC_DONATE_UPI not set',
    );
    const panel = page.locator('[data-panel="upi"]');
    await expect(panel.locator('[data-submit]')).toBeEnabled();
    await panel.locator('[data-submit]').click();
    // Locally STRIPE_SECRET_KEY is unset → 503 from /api/donate/intent.
    await expect(panel.locator('[data-error]')).toHaveText('Online giving is not set up yet.');
  });
});

test('intent endpoint rejects cross-origin requests', async ({ request }) => {
  const res = await request.post('/api/donate/intent', {
    headers: { origin: 'https://evil.example' },
    data: { currency: 'inr', baseCents: 50100, idempotencyKey: 'abcdef0123456789' },
  });
  expect(res.status()).toBe(403);
});
