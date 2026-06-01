import { expect, test } from '@playwright/test';

// Use a fresh email per test run so insertions don't collide across runs
// against the live dev DB. Workers/projects also get a suffix.
function uniqueEmail(label: string): string {
  return `qa-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

test.describe('subscribe form — API', () => {
  test('valid email returns success message', async ({ page }) => {
    await page.goto('/');
    const email = uniqueEmail('api-ok');
    const apiOk = await page.evaluate(async (em) => {
      const r = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: em, language: 'en' }),
      });
      return { status: r.status, body: await r.text() };
    }, email);
    expect(apiOk.status, `body: ${apiOk.body}`).toBe(200);
    expect(apiOk.body).toMatch(/inbox|confirm|ok/i);
  });

  test('invalid email returns 400 with helpful message', async ({ page }) => {
    await page.goto('/');
    const apiBad = await page.evaluate(async () => {
      const r = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'not-an-email', language: 'en' }),
      });
      return { status: r.status, body: await r.text() };
    });
    expect(apiBad.status).toBe(400);
    expect(apiBad.body).toMatch(/valid|email/i);
  });

  test('idempotent resubmit: subscribing twice with the same email returns 200 both times', async ({
    page,
  }) => {
    await page.goto('/');
    const email = uniqueEmail('idem');
    const both = await page.evaluate(async (em) => {
      async function post() {
        const r = await fetch('/api/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: em, language: 'en' }),
        });
        return { status: r.status, body: await r.json() };
      }
      const first = await post();
      const second = await post();
      return { first, second };
    }, email);
    expect(both.first.status).toBe(200);
    expect(both.first.body.ok).toBe(true);
    expect(both.second.status).toBe(200);
    expect(both.second.body.ok).toBe(true);
    expect(both.second.body.message).toMatch(/inbox|confirm/i);
  });

  test('language picker: reflects DB availability — disabled iff no published translations exist', async ({
    page,
  }) => {
    await page.goto('/');
    const select = page.locator('select[name="language"], select#language').first();
    if (!(await select.count())) {
      test.info().annotations.push({ type: 'skip', description: 'language picker not a select' });
      return;
    }
    const opts = await select.locator('option').evaluateAll((nodes) =>
      nodes.map((n) => ({
        value: (n as HTMLOptionElement).value,
        disabled: (n as HTMLOptionElement).disabled,
        text: n.textContent || '',
      })),
    );
    const en = opts.find((o) => o.value === 'en');
    expect(en, 'English option must exist').toBeDefined();
    expect(en?.disabled).toBe(false);
    for (const o of opts) {
      const looksUnavailable = /soon|unavailable|not\s+yet/i.test(o.text);
      expect(o.disabled).toBe(looksUnavailable);
    }
  });
});

test.describe('subscribe form — UI', () => {
  test('clicking subscribe in the band submits the form and shows success state', async ({
    page,
  }) => {
    await page.goto('/');

    const form = page.locator('[data-subscribe-form]').first();
    await expect(form).toBeVisible();

    const emailInput = form.locator('input[type="email"]');
    const submitBtn = form.locator('button[type="submit"]');
    const status = page.locator('[data-subscribe-status]').first();

    const email = uniqueEmail('ui-ok');
    await emailInput.fill(email);
    await submitBtn.click();

    // The script flips status to data-state="success" after a successful
    // fetch and shows the "Check your inbox" copy.
    await expect(status).toHaveAttribute('data-state', 'success', { timeout: 5000 });
    await expect(status).toContainText(/inbox|confirm/i);
  });

  test('UI idempotent resubmit: same email twice still shows success', async ({ page }) => {
    await page.goto('/');

    const form = page.locator('[data-subscribe-form]').first();
    const emailInput = form.locator('input[type="email"]');
    const submitBtn = form.locator('button[type="submit"]');
    const status = page.locator('[data-subscribe-status]').first();

    const email = uniqueEmail('ui-idem');

    await emailInput.fill(email);
    await submitBtn.click();
    await expect(status).toHaveAttribute('data-state', 'success', { timeout: 5000 });

    // Resubmit with the same email — should still be success, not error.
    await emailInput.fill(email);
    await submitBtn.click();
    await expect(status).toHaveAttribute('data-state', 'success', { timeout: 5000 });
  });
});
