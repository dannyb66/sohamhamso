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
    // Picker contract (post recommendation #5 — replaced native <select>
    // with a styled pill listbox to match the rest of the site chrome):
    //   - The form submits `language` via a hidden <input>, defaulted
    //     to `en`. This is what no-JS submits use.
    //   - The visible UI is a button (role implicit) + listbox of all
    //     12 languages. Available rows have data-available="true";
    //     unavailable rows have aria-disabled="true" + a "soon" badge.
    //   - English is selected by default; selecting an option (when one
    //     becomes available in the future) writes the hidden input.
    // Test pins the data contract — same intent as the ISSUE-007
    // regression that birthed this test, just against the new control.
    await page.goto('/');

    // 1) Hidden carrier exists and defaults to `en`.
    const hidden = page.locator('input[type="hidden"][name="language"]');
    await expect(hidden).toHaveCount(1);
    await expect(hidden).toHaveValue('en');

    // 2) No native <select> survives anywhere in the form — the whole
    //    point of the redesign is cross-platform consistency.
    const form = page.locator('[data-subscribe-form]');
    await expect(form.locator('select[name="language"]')).toHaveCount(0);

    // 3) Listbox renders all 12 catalogue rows.
    const rows = page.locator('[data-subscribe-lang-menu] li[role="option"]');
    await expect(rows).toHaveCount(12);

    // 4) Every row's disabled-vs-available state matches its label —
    //    "soon" badges go on aria-disabled=true, no others. This is the
    //    inverted, structural form of the original ISSUE-007 assertion.
    const states = await rows.evaluateAll((nodes) =>
      nodes.map((n) => ({
        code: (n as HTMLElement).dataset.langCode || '',
        available: (n as HTMLElement).dataset.available === 'true',
        disabled: n.getAttribute('aria-disabled') === 'true',
        text: n.textContent || '',
      })),
    );
    const en = states.find((s) => s.code === 'en');
    expect(en, 'English option must exist').toBeDefined();
    expect(en?.available).toBe(true);
    expect(en?.disabled).toBe(false);
    for (const s of states) {
      const looksUnavailable = /soon/i.test(s.text);
      // available <=> NOT disabled <=> no "soon" label
      expect(s.disabled).toBe(looksUnavailable);
      expect(s.available).toBe(!looksUnavailable);
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
